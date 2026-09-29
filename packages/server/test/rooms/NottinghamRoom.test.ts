import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { Client, Callbacks, Room } from '@colyseus/sdk';
import { NottinghamRoom } from '../../src/rooms/NottinghamRoom';
import { CardState } from '../../src/schema/GameState';

describe('NottinghamRoom (Colyseus 0.18)', () => {
  const TEST_PORT = 2569;
  let server: any;
  let client1: Client;
  let client2: Client;
  let client3: Client;
  let client4: Client;

  beforeAll(async () => {
    server = defineServer({
      rooms: {
        nottingham: defineRoom(NottinghamRoom),
      },
    });
    await server.listen(TEST_PORT);
    client1 = new Client(`http://localhost:${TEST_PORT}`);
    client2 = new Client(`http://localhost:${TEST_PORT}`);
    client3 = new Client(`http://localhost:${TEST_PORT}`);
    client4 = new Client(`http://localhost:${TEST_PORT}`);
  });

  afterAll(async () => {
    if (server) {
      await server.gracefullyShutdown(false);
    }
  });

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('allows a player to create a room, receive state, and toggle ready', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    expect(room1.roomId).toBeDefined();
    expect(typeof room1.roomId).toBe('string');
    expect(room1.sessionId).toBeDefined();

    await delay(100);

    const playersMap = room1.state.players;
    expect(playersMap.get(room1.sessionId)).toBeDefined();
    expect(playersMap.get(room1.sessionId).name).toBe('Robin');
    expect(playersMap.get(room1.sessionId).ready).toBe(false);

    room1.send('ready');
    await delay(100);

    expect(playersMap.get(room1.sessionId).ready).toBe(true);

    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    await delay(100);

    expect(room1.state.players.size).toBe(2);
    expect(room2.state.players.size).toBe(2);

    await room1.leave();
    await room2.leave();
  });

  it('enforces zero-knowledge state isolation: client never receives other players hand or sealed bag cards', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    // All 3 players ready up to trigger game start
    room1.send('ready');
    room2.send('ready');
    room3.send('ready');

    await delay(200);

    expect(room1.state.phase).toBe('MARKET');
    expect(room2.state.phase).toBe('MARKET');

    // Robin (room1) can see own hand cards
    const robinInRoom1 = room1.state.players.get(room1.sessionId);
    expect(robinInRoom1.hand.length).toBe(6);
    expect(robinInRoom1.hand[0].id).toBeDefined();

    // Marian (room2) CANNOT see Robin's hand cards (zero-knowledge view)
    const robinInRoom2 = room2.state.players.get(room1.sessionId);
    expect(robinInRoom2.hand?.length ?? 0).toBe(0); // View filtering hides cards!
    expect(robinInRoom2.handCount).toBe(6); // Public count remains visible

    // Little John (room3) CANNOT see Robin's hand cards
    const robinInRoom3 = room3.state.players.get(room1.sessionId);
    expect(robinInRoom3.hand?.length ?? 0).toBe(0);

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });

  it('rejects stale bribe acceptance when offer sequence number changes (atomic reaction buffer)', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    // Start game
    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    // Fast-forward to inspection phase directly on room instance
    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    serverRoom.state.phase = 'INSPECTION';

    let errorMessageReceived = '';
    room1.onMessage('error', (data: any) => {
      errorMessageReceived = data.message;
    });

    // Merchant (room2) proposes bribe 1
    room2.send('bribe_propose', { gold: 5 });
    await delay(100);

    const seq1 = serverRoom.state.activeBribe!.sequenceNumber;
    expect(seq1).toBeDefined();

    // Merchant (room2) changes bribe to 10 gold before Sheriff responds
    room2.send('bribe_propose', { gold: 10 });
    await delay(100);

    const seq2 = serverRoom.state.activeBribe!.sequenceNumber;
    expect(seq2).toBeGreaterThan(seq1);

    // Sheriff (room1) tries to accept using stale sequence number (seq1)
    room1.send('bribe_respond', { accept: true, sequenceNumber: seq1 });
    await delay(100);

    // Assert stale acceptance was rejected
    expect(errorMessageReceived).toMatch(/changed before response/);
    expect(serverRoom.state.activeBribe!.status).toBe('PROPOSED'); // Still proposed, not accepted!

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });

  it('simulates a full 4-player game round end-to-end through all phase transitions', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });
    const room4 = await client4.joinById(room1.roomId, { playerName: 'FriarTuck' });

    await delay(100);

    // Phase: LOBBY
    expect(room1.state.phase).toBe('LOBBY');
    expect(room1.state.players.size).toBe(4);

    // Start game
    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    room4.send('ready');
    await delay(200);

    // Phase 1: MARKET
    expect(room1.state.phase).toBe('MARKET');
    expect(room1.state.round).toBe(1);
    expect(room1.state.sheriffId).toBe(room1.sessionId); // Robin is Sheriff

    // Merchants take turns in Market
    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    const roomsMap: Record<string, Room> = {
      [room1.sessionId]: room1,
      [room2.sessionId]: room2,
      [room3.sessionId]: room3,
      [room4.sessionId]: room4,
    };

    // Complete all merchant turns in Market
    for (let i = 0; i < 3; i++) {
      const activeId = serverRoom.state.activeMerchantId;
      expect(activeId).toBeTruthy();
      const activeRoom = roomsMap[activeId];
      // Merchant passes without exchanging (discards 0 cards)
      activeRoom.send('market_exchange', { cardIds: [] });
      await delay(100);
    }

    // Phase 2: LOAD_BAG
    expect(room1.state.phase).toBe('LOAD_BAG');

    // Each merchant loads 2 cards from their hand into bag
    const merchants = [room2, room3, room4];
    for (const mRoom of merchants) {
      const pState = serverRoom.state.players.get(mRoom.sessionId)!;
      const cardIdsToLoad = [pState.hand[0].id, pState.hand[1].id];
      mRoom.send('load_bag', { cardIds: cardIdsToLoad });
      await delay(100);
    }

    // Phase 3: DECLARATION (Merchants declare in parallel)
    expect(room1.state.phase).toBe('DECLARATION');

    for (const mRoom of merchants) {
      mRoom.send('declaration', { declaredGood: 'APPLE', declaredCount: 2 });
      await delay(100);
    }
    await delay(100);

    // Phase 4: INSPECTION
    expect(room1.state.phase).toBe('INSPECTION');

    // Sheriff (Robin in room1) passes Marian, and inspects John and Tuck
    room1.send('inspection_action', { type: 'PASS', targetPlayerId: room2.sessionId });
    await delay(100);

    room1.send('inspection_action', { type: 'INSPECT', targetPlayerId: room3.sessionId });
    await delay(100);

    room1.send('inspection_action', { type: 'INSPECT', targetPlayerId: room4.sessionId });
    await delay(150);

    // All merchants inspected -> Round concludes!
    // Next round begins or game ends
    expect(serverRoom.state.round).toBeGreaterThanOrEqual(1);
    expect(['MARKET', 'GAME_OVER']).toContain(serverRoom.state.phase);

    await room1.leave();
    await room2.leave();
    await room3.leave();
    await room4.leave();
  });

  it('records who discarded what cards per turn in discardLog and updates discardPile in real time', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    // Ready up
    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    expect(serverRoom.state.phase).toBe('MARKET');

    const roomsMap: Record<string, any> = {
      [room1.sessionId]: room1,
      [room2.sessionId]: room2,
      [room3.sessionId]: room3,
    };

    // First merchant turn
    const firstMerchantId = serverRoom.state.activeMerchantId;
    const firstRoom = roomsMap[firstMerchantId];
    const firstPlayerState = serverRoom.state.players.get(firstMerchantId)!;
    const cardsToDiscard = [firstPlayerState.hand[0].id, firstPlayerState.hand[1].id];
    const discardedCardNames = [firstPlayerState.hand[0].name, firstPlayerState.hand[1].name];

    firstRoom.send('market_exchange', { cardIds: cardsToDiscard });
    await delay(150);

    // Verify first discard entry in discardLog
    expect(serverRoom.state.discardLog.length).toBe(1);
    const log1 = serverRoom.state.discardLog[0];
    expect(log1.playerName).toBe(firstPlayerState.name);
    expect(log1.cardCount).toBe(2);
    expect(Array.from(log1.cardNames)).toEqual(discardedCardNames);

    // Verify discardPile updated
    expect(serverRoom.state.discardPile.length).toBeGreaterThanOrEqual(2);

    // Second merchant keeps hand (0 discards)
    const secondMerchantId = serverRoom.state.activeMerchantId;
    const secondRoom = roomsMap[secondMerchantId];
    const secondPlayerState = serverRoom.state.players.get(secondMerchantId)!;

    secondRoom.send('market_exchange', { cardIds: [] });
    await delay(150);

    expect(serverRoom.state.discardLog.length).toBe(2);
    const log2 = serverRoom.state.discardLog[1];
    expect(log2.playerName).toBe(secondPlayerState.name);
    expect(log2.cardCount).toBe(0);
    expect(log2.cardNames.length).toBe(0);

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });

  it('runs complete 3-player game flow from LOBBY through LOAD_BAG and DECLARATION into INSPECTION', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    expect(serverRoom.state.phase).toBe('MARKET');
    expect(serverRoom.state.players.size).toBe(3);

    const roomsMap: Record<string, Room> = {
      [room1.sessionId]: room1,
      [room2.sessionId]: room2,
      [room3.sessionId]: room3,
    };

    // Both merchants pass market phase
    for (let i = 0; i < 2; i++) {
      const activeId = serverRoom.state.activeMerchantId;
      expect(activeId).toBeTruthy();
      const activeRoom = roomsMap[activeId];
      activeRoom.send('market_exchange', { cardIds: [] });
      await delay(100);
    }

    // Now in LOAD_BAG phase
    expect(serverRoom.state.phase).toBe('LOAD_BAG');
    expect(room1.state.phase).toBe('LOAD_BAG');
    expect(room2.state.phase).toBe('LOAD_BAG');
    expect(room3.state.phase).toBe('LOAD_BAG');

    // Marian (room2) snaps bag
    const marianState = serverRoom.state.players.get(room2.sessionId)!;
    room2.send('load_bag', { cardIds: [marianState.hand[0].id, marianState.hand[1].id] });
    await delay(100);

    // Phase should STILL be LOAD_BAG because LittleJohn has not snapped yet
    expect(serverRoom.state.phase).toBe('LOAD_BAG');

    // LittleJohn (room3) snaps bag
    const johnState = serverRoom.state.players.get(room3.sessionId)!;
    room3.send('load_bag', { cardIds: [johnState.hand[0].id, johnState.hand[1].id] });
    await delay(100);

    // Phase MUST now be DECLARATION!
    expect(serverRoom.state.phase).toBe('DECLARATION');
    expect(room1.state.phase).toBe('DECLARATION');
    expect(room2.state.phase).toBe('DECLARATION');
    expect(room3.state.phase).toBe('DECLARATION');

    expect(room1.state.players.get(room2.sessionId)?.sealedBag?.isSnapped).toBe(true);
    expect(room2.state.players.get(room2.sessionId)?.sealedBag?.isSnapped).toBe(true);
    expect(room2.state.players.get(room3.sessionId)?.sealedBag?.isSnapped).toBe(true);

    // Now Marian declares
    room2.send('declaration', { declaredGood: 'APPLE', declaredCount: 2 });
    await delay(100);

    expect(serverRoom.state.phase).toBe('DECLARATION');
    expect(serverRoom.state.players.get(room2.sessionId)!.sealedBag!.declaredGood).toBe('APPLE');

    // LittleJohn declares
    room3.send('declaration', { declaredGood: 'CHEESE', declaredCount: 2 });
    await delay(100);

    // Both declared -> must advance to INSPECTION!
    expect(serverRoom.state.phase).toBe('INSPECTION');
    expect(room1.state.phase).toBe('INSPECTION');
    expect(room2.state.phase).toBe('INSPECTION');
    expect(room3.state.phase).toBe('INSPECTION');

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });

  it('transitions to GAME_OVER, reveals zero-knowledge stands, and produces leaderboard upon game end', async () => {
    const room1 = await client1.create('nottingham', {
      playerName: 'Robin',
      maxPlayers: 3,
      enableRoyalGoods: true,
      enableBlackMarket: true,
      sheriffRounds: 2,
    });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    expect(serverRoom.state.phase).toBe('MARKET');
    expect(serverRoom.state.sheriffRounds).toBe(2);
    expect(serverRoom.state.totalRounds).toBe(6);

    // Verify client received initial round metadata
    expect(room1.state.sheriffRounds).toBe(2);
    expect(room1.state.totalRounds).toBe(6);

    // Place a contraband card on Marian's stand
    const marian = serverRoom.state.players.get(room2.sessionId)!;
    const contrabandCard = new CardState({
      id: 'contra-silk-1',
      name: 'Silk',
      classification: 'CONTRABAND',
      contrabandType: 'SILK',
      value: 4,
      penalty: 2,
    });
    marian.standContraband.push(contrabandCard);
    // Give owner view access initially
    serverRoom.clients.find((c) => c.sessionId === room2.sessionId)?.view?.add(contrabandCard);

    await delay(100);

    // Robin (room1) should not see Marian's contraband card due to zero-knowledge isolation
    expect(room1.state.players.get(room2.sessionId)?.standContraband?.length ?? 0).toBe(0);

    // Fast-forward rounds to totalRounds (6) to trigger game finish
    serverRoom.state.round = 6;
    (serverRoom as any).handleRoundEnd();

    await delay(200);

    // Game should be in GAME_OVER state
    expect(serverRoom.state.phase).toBe('GAME_OVER');
    expect(room1.state.phase).toBe('GAME_OVER');
    expect(room2.state.phase).toBe('GAME_OVER');
    expect(room3.state.phase).toBe('GAME_OVER');

    // Leaderboard populated
    expect(serverRoom.state.leaderboard.length).toBe(3);
    expect(room1.state.leaderboard.length).toBe(3);
    expect(room1.state.winnerId).toBeDefined();
    expect(typeof room1.state.winningScore).toBe('number');

    // Zero-knowledge reveal: Robin (room1) can now see Marian's stand contraband!
    const marianStandOnRobin = room1.state.players.get(room2.sessionId)?.standContraband;
    expect(marianStandOnRobin).toBeDefined();
    expect(marianStandOnRobin!.length).toBe(1);
    expect(marianStandOnRobin![0].name).toBe('Silk');

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });

  it('handles player forfeit and crowns remaining connected player without hanging', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;
    expect(serverRoom.state.phase).toBe('MARKET');

    // Marian and LittleJohn leave mid-game
    await room2.leave();
    await room3.leave();
    await delay(200);

    // Only Robin remains connected -> game ends and Robin is crowned rank 1 by forfeit
    expect(serverRoom.state.phase).toBe('GAME_OVER');
    expect(room1.state.phase).toBe('GAME_OVER');
    expect(room1.state.leaderboard.length).toBeGreaterThanOrEqual(1);
    expect(room1.state.leaderboard[0].playerId).toBe(room1.sessionId);
    expect(room1.state.leaderboard[0].rank).toBe(1);

    await room1.leave();
  });

  it('supports shared victory with multiple co-winners tied for rank 1', async () => {
    const room1 = await client1.create('nottingham', { playerName: 'Robin' });
    const room2 = await client2.joinById(room1.roomId, { playerName: 'Marian' });
    const room3 = await client3.joinById(room1.roomId, { playerName: 'LittleJohn' });

    await delay(100);

    room1.send('ready');
    room2.send('ready');
    room3.send('ready');
    await delay(200);

    const serverRoom = matchMaker.getLocalRoomById(room1.roomId) as NottinghamRoom;

    // Give Robin and Marian identical gold and legal cards to ensure tie
    const robin = serverRoom.state.players.get(room1.sessionId)!;
    const marian = serverRoom.state.players.get(room2.sessionId)!;
    robin.gold = 50;
    marian.gold = 50;

    robin.standLegal.clear();
    marian.standLegal.clear();
    robin.standContraband.clear();
    marian.standContraband.clear();

    const apple1 = new CardState({ id: 'a1', name: 'Apple', classification: 'LEGAL', goodType: 'APPLE', value: 2 });
    const apple2 = new CardState({ id: 'a2', name: 'Apple', classification: 'LEGAL', goodType: 'APPLE', value: 2 });
    robin.standLegal.push(apple1);
    marian.standLegal.push(apple2);

    // Fast-forward rounds to totalRounds
    serverRoom.state.round = serverRoom.state.totalRounds;
    (serverRoom as any).handleRoundEnd();

    await delay(200);

    expect(serverRoom.state.phase).toBe('GAME_OVER');
    expect(room1.state.phase).toBe('GAME_OVER');

    // Both Robin and Marian should have rank 1
    const rank1s = Array.from(room1.state.leaderboard).filter((b) => b.rank === 1);
    expect(rank1s.length).toBe(2);

    await room1.leave();
    await room2.leave();
    await room3.leave();
  });
});


