import { Room, Client } from 'colyseus';
import { StateView } from '@colyseus/schema';
import {
  Card,
  GoodType,
  ContrabandType,
  SHERIFF_ROUNDS_BY_PLAYER_COUNT,
  MarketDiscardMessage,
  LoadBagMessage,
  DeclarationMessage,
  InspectionAction,
  BribeOfferMessage,
  BribeResponseMessage,
  SelectStartPlayerMessage,
  SelectInspectMerchantMessage,
  UpdateLobbyOptionsMessage,
  DeputyInspectionMessage,
  ClaimBlackMarketMessage,
  ProposeNegotiationOfferMessage,
  AcceptNegotiationOfferMessage,
  DeclineNegotiationOfferMessage,
  WithdrawNegotiationOfferMessage,
  BribeReconciliationRecord,
  ForcedCommitmentOutcome,
} from '@sheriff/shared';
import {
  GameState,
  PlayerState,
  CardState,
  SealedBagState,
  BribeOfferState,
  PlayerScoreState,
  BootyTileState,
  BlackMarketOrderState,
  NegotiationOfferState,
  PendingCommitmentState,
  DiscardLogEntryState,
} from '../schema/GameState';
import {
  buildDeck,
  shuffleDeck,
  drawCards,
  dealStartingHands,
  initMarketPhase,
  getCurrentMarketMerchant,
  exchangeMarketCards,
  finalizeMarketPhase,
  MarketPhaseState,
  validateBagCards,
  loadAndSnapBag,
  getDeclarationOrder,
  validateDeclaration,
  applyDeclaration,
  resolveInspection,
  resolvePassUnopened,
  resolveDebt,
  calculateScores,
  PlayerStandInput,
  initDeputiesState,
  drawDeputiesForRound,
  distributeBootyTile,
  DeputiesState,
  initBlackMarketState,
  canClaimBlackMarketOrder,
  claimBlackMarketOrder,
  resetRoundBlackMarketClaims,
  BlackMarketState,
  BlackMarketCard,
} from '../engine';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function cardToState(c: Card): CardState {
  return new CardState({
    id: c.id,
    name: c.name,
    classification: c.classification,
    goodType: c.goodType || '',
    contrabandType: c.contrabandType || '',
    royalGoodType: c.royalGoodType || '',
    baseGood: c.baseGood || '',
    royalBonusCount: c.royalBonusCount || 0,
    value: c.value,
    penalty: c.penalty,
  });
}

function stateToCard(s: CardState): Card {
  const card: Card = {
    id: s.id,
    name: s.name,
    classification: s.classification as any,
    value: s.value,
    penalty: s.penalty,
  };
  if (s.goodType) card.goodType = s.goodType as GoodType;
  if (s.contrabandType) card.contrabandType = s.contrabandType as ContrabandType;
  if (s.royalGoodType) card.royalGoodType = s.royalGoodType as any;
  if (s.baseGood) card.baseGood = s.baseGood as GoodType;
  if (s.royalBonusCount) card.royalBonusCount = s.royalBonusCount;
  return card;
}

function blackMarketCardToState(c: BlackMarketCard): BlackMarketOrderState {
  return new BlackMarketOrderState({
    id: c.id,
    name: c.name,
    contrabandType: c.contrabandType,
    requiredCount: c.requiredCount,
    pointsValue: c.pointsValue,
  });
}

function syncBlackMarketPiles(state: GameState, bmState: BlackMarketState) {
  state.blackMarketPepperPile.clear();
  for (const c of bmState.pepperPile) state.blackMarketPepperPile.push(blackMarketCardToState(c));

  state.blackMarketMeadPile.clear();
  for (const c of bmState.meadPile) state.blackMarketMeadPile.push(blackMarketCardToState(c));

  state.blackMarketSilkPile.clear();
  for (const c of bmState.silkPile) state.blackMarketSilkPile.push(blackMarketCardToState(c));
}

export class NottinghamRoom extends Room<{ state: GameState }> {
  maxClients = 6;

  // Server-authoritative state
  internalDrawPile: Card[] = [];
  internalDiscardPile: Card[] = [];
  tableSeatIds: string[] = [];
  marketState?: MarketPhaseState;
  declarationOrder: string[] = [];
  declarationIndex = 0;
  inspectedMerchantIds = new Set<string>();
  bribeSequenceNumber = 1;
  deputiesEngineState?: DeputiesState;
  blackMarketEngineState?: BlackMarketState;
  optionsSheriffRounds?: number;

  onCreate(options: any) {
    this.roomId = generateRoomCode();

    this.setState(new GameState());
    this.state.phase = 'LOBBY';
    this.state.maxPlayers = options?.maxPlayers || 4;
    this.state.enableRoyalGoods = options?.enableRoyalGoods || false;
    this.state.enableDeputies = options?.enableDeputies || false;
    this.state.enableBlackMarket = options?.enableBlackMarket || false;
    this.optionsSheriffRounds = options?.sheriffRounds ? Number(options.sheriffRounds) : undefined;

    this.setupMessageHandlers();
  }

  onJoin(client: Client, options: any) {
    client.view = new StateView();

    const seatIndex = this.tableSeatIds.length;
    const playerId = client.sessionId;
    this.tableSeatIds.push(playerId);

    const player = new PlayerState({
      id: playerId,
      sessionId: playerId,
      name: options?.playerName || `Player ${seatIndex + 1}`,
      gold: 50,
      ready: false,
      seatIndex,
    });

    this.state.players.set(playerId, player);

    // Zero-knowledge visibility: player's hand and private contraband only visible to them
    client.view.add(player);
    client.view.subscribe(player.hand);
    client.view.subscribe(player.standContraband);
    client.view.subscribe(player.standRoyal);
  }

  async onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Normal disconnection / voluntary leave (code 1000 is normal WS closure)
    const isConsented = code === 1000 || code === 4000;

    if (this.state.phase === 'LOBBY' || isConsented) {
      this.state.players.delete(client.sessionId);
      const idx = this.tableSeatIds.indexOf(client.sessionId);
      if (idx !== -1) this.tableSeatIds.splice(idx, 1);
    } else {
      player.connected = false;
      try {
        // Allow reconnection buffer (GDD §6.2)
        await this.allowReconnection(client, 30);
        player.connected = true;
        // Re-grant client view permissions on reconnect with complete zero-knowledge isolation
        if (client.view) {
          const view = client.view;
          view.add(player);
          view.subscribe(player.hand);
          view.subscribe(player.standContraband);
          view.subscribe(player.standRoyal);
          for (const card of player.hand) view.add(card);
          for (const card of player.standContraband) view.add(card);
          for (const card of player.standRoyal) view.add(card);
          if (player.sealedBag) {
            view.add(player.sealedBag);
            view.subscribe(player.sealedBag.cards);
            for (const card of player.sealedBag.cards) view.add(card);
          }
          this.state.players.forEach((otherP) => {
            if (otherP.id !== player.id && otherP.sealedBag) {
              view.add(otherP.sealedBag);
              if (otherP.sealedBag.isRevealed) {
                view.subscribe(otherP.sealedBag.cards);
                for (const card of otherP.sealedBag.cards) view.add(card);
              }
            }
          });
        }
      } catch {
        player.connected = false;
      }
    }
  }

  onDispose() {
    this.internalDrawPile = [];
    this.internalDiscardPile = [];
    this.tableSeatIds = [];
    this.declarationOrder = [];
    this.declarationIndex = 0;
    this.inspectedMerchantIds.clear();
    this.bribeSequenceNumber = 1;
    this.state.negotiationFeed.clear();
    this.state.pendingCommitments.clear();
    this.state.negotiationSequence = 1;
    this.state.currentInspectionBagOwnerId = '';
    this.marketState = undefined;
    this.deputiesEngineState = undefined;
    this.blackMarketEngineState = undefined;
  }

  private setupMessageHandlers() {
    // 1. Ready toggle in Lobby
    this.onMessage('ready', (client) => {
      if (this.state.phase !== 'LOBBY') {
        client.send('error', { message: 'Cannot change ready state after game has started' });
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.ready = !player.ready;

      // Start game when all players are ready and minimum player count met
      if (this.state.phase === 'LOBBY' && this.state.players.size >= 3) {
        let allReady = true;
        this.state.players.forEach((p) => {
          if (!p.ready) allReady = false;
        });

        if (allReady) {
          this.startGame();
        }
      }
    });

    // 2. Select starting player for Market Phase (Sheriff only)
    this.onMessage('select_start_player', (client, message: SelectStartPlayerMessage) => {
      if (this.state.phase !== 'MARKET') {
        client.send('error', { message: 'Can only select start player during MARKET phase' });
        return;
      }
      if (client.sessionId !== this.state.sheriffId) {
        client.send('error', { message: 'Only the Sheriff can select the starting merchant' });
        return;
      }

      const targetId = message.playerId;
      if (!this.state.players.has(targetId) || targetId === this.state.sheriffId) {
        client.send('error', { message: 'Must select a valid merchant' });
        return;
      }

      this.marketState = initMarketPhase({
        tableSeats: this.tableSeatIds,
        sheriffId: this.state.sheriffId,
        startingMerchantId: targetId,
      });

      this.state.activeMerchantId = getCurrentMarketMerchant(this.marketState) || '';
    });

    // 3. Market discard & redraw exchange
    this.onMessage('market_exchange', (client, message: MarketDiscardMessage) => {
      if (this.state.phase !== 'MARKET' || !this.marketState) {
        client.send('error', { message: 'Market exchange is only allowed during MARKET phase' });
        return;
      }
      if (client.sessionId !== this.state.activeMerchantId) {
        client.send('error', { message: 'It is not your market turn' });
        return;
      }

      const player = this.state.players.get(client.sessionId)!;
      if (message.cardIds && message.cardIds.length > 5) {
        client.send('error', { message: 'Cannot discard more than 5 cards' });
        return;
      }

      const handCardIds = new Set(player.hand.map((c) => c.id));
      for (const id of message.cardIds || []) {
        if (!handCardIds.has(id)) {
          client.send('error', { message: `Card ${id} is not present in player hand` });
          return;
        }
      }

      const handCards = player.hand.map(stateToCard);

      const result = exchangeMarketCards({
        state: this.marketState,
        playerId: client.sessionId,
        cardIdsToDiscard: message.cardIds || [],
        hand: handCards,
        drawPile: this.internalDrawPile,
        discardPile: this.internalDiscardPile,
      });

      this.marketState = result.nextState;
      this.internalDrawPile = result.newDrawPile;
      this.internalDiscardPile = result.newDiscardPile;
      this.state.drawPileCount = this.internalDrawPile.length;

      // Update player hand
      player.hand.clear();
      for (const card of result.newHand) {
        const cs = cardToState(card);
        player.hand.push(cs);
        if (client.view) {
          client.view.add(cs);
        }
      }
      player.handCount = result.newHand.length;

      // Record who discarded what cards per turn for the Town Ledger
      const discardEntry = new DiscardLogEntryState();
      discardEntry.id = `discard_${client.sessionId}_${this.state.round}_${Date.now()}`;
      discardEntry.round = this.state.round;
      discardEntry.playerId = client.sessionId;
      discardEntry.playerName = player.name;
      discardEntry.cardCount = result.discardedCards.length;
      discardEntry.timestamp = Date.now();
      for (const card of result.discardedCards) {
        discardEntry.cardNames.push(card.name);
      }
      this.state.discardLog.push(discardEntry);

      // Immediately add the discarded cards to the public discard pile so players can inspect them
      for (const card of result.discardedCards) {
        this.state.discardPile.push(cardToState(card));
      }

      if (result.isMarketComplete) {
        const { finalDiscardPile } = finalizeMarketPhase(this.marketState, this.internalDiscardPile);
        this.internalDiscardPile = finalDiscardPile;

        this.state.discardPile.clear();
        for (const card of this.internalDiscardPile) {
          this.state.discardPile.push(cardToState(card));
        }

        // Transition to Load Bag
        this.startLoadBagPhase();
      } else {
        this.state.activeMerchantId = getCurrentMarketMerchant(this.marketState) || '';
      }
    });

    // 4. Load Merchant Bag
    this.onMessage('load_bag', (client, message: LoadBagMessage) => {
      if (this.state.phase !== 'LOAD_BAG') {
        client.send('error', { message: 'Can only load bag during LOAD_BAG phase' });
        return;
      }
      if (client.sessionId === this.state.sheriffId) {
        client.send('error', { message: 'Sheriff does not pack a merchant bag' });
        return;
      }

      const player = this.state.players.get(client.sessionId)!;
      if (player.sealedBag?.isSnapped) {
        client.send('error', { message: 'Bag is already sealed shut' });
        return;
      }

      const handCards = player.hand.map(stateToCard);
      let loadResult;
      try {
        loadResult = loadAndSnapBag({
          playerId: client.sessionId,
          hand: handCards,
          cardIdsToLoad: message.cardIds,
        });
      } catch (err: any) {
        client.send('error', { message: err.message || 'Invalid card selection for bag' });
        return;
      }

      const { sealedBag, remainingHand } = loadResult;

      // Update hand
      player.hand.clear();
      for (const card of remainingHand) {
        const cs = cardToState(card);
        player.hand.push(cs);
        if (client.view) {
          client.view.add(cs);
        }
      }
      player.handCount = remainingHand.length;

      // Update sealed bag
      const bagState = new SealedBagState({
        playerId: client.sessionId,
        cardCount: sealedBag.cards.length,
        isSnapped: true,
        isRevealed: false,
      });

      player.sealedBag = bagState;

      // Add bagState to all clients' views so everyone sees that the merchant bag is sealed & count is visible
      this.clients.forEach((c) => {
        if (c.view) {
          c.view.add(bagState);
        }
      });

      // Grant owning client private view permission for their secret bag cards
      if (client.view) {
        client.view.subscribe(bagState.cards);
      }

      for (const card of sealedBag.cards) {
        const cs = cardToState(card);
        bagState.cards.push(cs);
        if (client.view) {
          client.view.add(cs);
        }
      }

      // Check if all active merchants have snapped bags
      const activeMerchants = this.tableSeatIds
        .filter((id) => id !== this.state.sheriffId && !this.state.deputyIds.includes(id))
        .map((id) => this.state.players.get(id))
        .filter((p): p is PlayerState => Boolean(p && p.connected !== false));

      const allSnapped =
        activeMerchants.length > 0 &&
        activeMerchants.every((p) => Boolean(p.sealedBag?.isSnapped));

      if (allSnapped) {
        this.startDeclarationPhase();
      }
    });

    // 5. Declaration (All merchants can declare in parallel after snapping bags)
    this.onMessage('declaration', (client, message: DeclarationMessage) => {
      if (this.state.phase !== 'DECLARATION') {
        client.send('error', { message: 'Can only make declarations during DECLARATION phase' });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player || !player.sealedBag) {
        client.send('error', { message: 'Merchant bag not found' });
        return;
      }

      if (!player.sealedBag.isSnapped) {
        client.send('error', { message: 'Must snap bag before declaring' });
        return;
      }

      if (player.sealedBag.declaredGood) {
        client.send('error', { message: 'Bag has already been declared' });
        return;
      }

      const declaredCount = Number(message.declaredCount) || player.sealedBag.cards.length;
      const bagCards = player.sealedBag.cards.map(stateToCard);

      const validation = validateDeclaration(bagCards, declaredCount, message.declaredGood);
      if (!validation.valid) {
        client.send('error', { message: validation.error });
        return;
      }

      player.sealedBag.declaredGood = message.declaredGood;
      player.sealedBag.declaredCount = declaredCount;

      this.broadcast('merchant_declaration_announced', {
        merchantId: client.sessionId,
        merchantName: player.name,
        declaredGood: message.declaredGood,
        declaredCount,
      });

      // Check if all active merchants (non-Sheriff, non-deputy players with bags) have declared
      const activeMerchants = this.tableSeatIds
        .filter((id) => id !== this.state.sheriffId && !this.state.deputyIds.includes(id))
        .map((id) => this.state.players.get(id))
        .filter((p): p is PlayerState => Boolean(p && p.connected !== false));

      const allDeclared =
        activeMerchants.length > 0 &&
        activeMerchants.every((m) => Boolean(m.sealedBag?.declaredGood));

      if (allDeclared) {
        this.startInspectionPhase();
      }
    });

    // 6. Propose Negotiation Offer (All-Players, All-Bags, Concurrently)
    this.onMessage('negotiation_propose', (client, message: ProposeNegotiationOfferMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only propose negotiation offers during INSPECTION phase' });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (!message.targetBagOwnerId || !this.state.players.has(message.targetBagOwnerId)) {
        client.send('error', { message: 'Invalid target bag owner' });
        return;
      }

      if (this.inspectedMerchantIds.has(message.targetBagOwnerId)) {
        client.send('error', { message: 'Target merchant bag has already been resolved' });
        return;
      }

      const targetPlayer = this.state.players.get(message.targetBagOwnerId)!;
      if (!targetPlayer.sealedBag || !targetPlayer.sealedBag.isSnapped) {
        client.send('error', { message: 'Target merchant bag is not sealed' });
        return;
      }

      const goldOffered = Number(message.goldOffered) || 0;
      if (goldOffered < 0 || !Number.isInteger(goldOffered)) {
        client.send('error', { message: 'Gold offered must be a non-negative integer' });
        return;
      }

      if (goldOffered > player.gold) {
        client.send('error', { message: 'Cannot offer more gold than you currently hold' });
        return;
      }

      if (message.standLegalGoodsOffered && message.standLegalGoodsOffered.length > 0) {
        const standLegalIds = new Set(player.standLegal.map((c) => c.id));
        for (const cardId of message.standLegalGoodsOffered) {
          if (!standLegalIds.has(cardId)) {
            client.send('error', { message: `Card ${cardId} is not on your legal stand` });
            return;
          }
        }
      }

      const standContrabandCountOffered = Number(message.standContrabandCountOffered) || 0;
      if (standContrabandCountOffered < 0 || !Number.isInteger(standContrabandCountOffered)) {
        client.send('error', { message: 'Stand contraband count must be a non-negative integer' });
        return;
      }

      const bagGoodsCountOffered = Number(message.bagGoodsCountOffered) || 0;
      if (bagGoodsCountOffered < 0 || !Number.isInteger(bagGoodsCountOffered)) {
        client.send('error', { message: 'Bag goods count must be a non-negative integer' });
        return;
      }

      const intendedOutcome =
        message.intendedOutcome ||
        (message.targetBagOwnerId === client.sessionId ? 'PASS' : 'INSPECT');

      this.state.negotiationSequence++;

      const offerState = new NegotiationOfferState({
        id: `offer_${this.state.negotiationSequence}`,
        fromPlayerId: client.sessionId,
        targetBagOwnerId: message.targetBagOwnerId,
        intendedOutcome,
        goldOffered,
        standLegalGoodsOffered: message.standLegalGoodsOffered || [],
        standContrabandCountOffered,
        bagGoodsCountOffered,
        futureFavorText: message.futureFavorText || '',
        status: 'OPEN',
        acceptedByPlayerId: '',
        sequence: this.state.negotiationSequence,
        timestamp: Date.now(),
      });

      this.state.negotiationFeed.push(offerState);

      // Mirror into legacy activeBribe & bribeOffers for backward compatibility
      this.bribeSequenceNumber = this.state.negotiationSequence;
      const isSheriff = client.sessionId === this.state.sheriffId;
      const legacyBribe = new BribeOfferState({
        id: offerState.id,
        sequenceNumber: offerState.sequence,
        fromPlayerId: client.sessionId,
        toPlayerId: isSheriff ? message.targetBagOwnerId : this.state.sheriffId,
        gold: goldOffered,
        standCardIds: message.standLegalGoodsOffered || [],
        bagCardClaims: [],
        nonBindingTerms: message.futureFavorText || '',
        status: 'PROPOSED',
        createdAt: Date.now(),
      });
      this.state.activeBribe = legacyBribe;
      const existingIdx = this.state.bribeOffers.findIndex((b) => b.fromPlayerId === client.sessionId);
      if (existingIdx !== -1) {
        this.state.bribeOffers[existingIdx] = legacyBribe;
      } else {
        this.state.bribeOffers.push(legacyBribe);
      }

      // Non-blocking toast notification for cross-bag offers
      if (message.targetBagOwnerId !== client.sessionId) {
        this.broadcast('negotiation_cross_bag_toast', {
          fromPlayerId: client.sessionId,
          fromPlayerName: player.name,
          targetBagOwnerId: message.targetBagOwnerId,
          targetPlayerName: targetPlayer.name,
          goldOffered,
          intendedOutcome,
        });
      }
    });

    // 7. Accept Negotiation Offer (Deciding Authority or Merchant responding to Sheriff offer, with sequence concurrency lock)
    this.onMessage('negotiation_accept', (client, message: AcceptNegotiationOfferMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only accept offers during INSPECTION phase' });
        return;
      }

      const offer = this.state.negotiationFeed.find((o) => o.id === message.offerId);
      if (!offer || offer.status !== 'OPEN') {
        client.send('error', { message: 'Offer is not available for acceptance' });
        return;
      }

      if (offer.fromPlayerId === client.sessionId) {
        client.send('error', { message: 'Cannot accept your own offer' });
        return;
      }

      const isAuthority =
        client.sessionId === this.state.sheriffId ||
        this.state.deputyIds.includes(client.sessionId);

      const isOfferFromAuthority =
        offer.fromPlayerId === this.state.sheriffId ||
        this.state.deputyIds.includes(offer.fromPlayerId);

      // If the offer was proposed by the Sheriff or Deputy, any other player can accept it.
      // If the offer was proposed by a merchant/rival, only the Sheriff or Deputy can accept it.
      const canAccept = isOfferFromAuthority
        ? client.sessionId !== offer.fromPlayerId
        : isAuthority;

      if (!canAccept) {
        client.send('error', { message: 'Only the Sheriff or Deputy can accept negotiation offers' });
        return;
      }

      if (this.inspectedMerchantIds.has(offer.targetBagOwnerId)) {
        client.send('error', { message: 'Target merchant bag has already been resolved' });
        return;
      }

      // Reject stale acceptance if sequence has advanced since offer was inspected
      if (
        message.expectedSequence !== undefined &&
        message.expectedSequence !== this.state.negotiationSequence
      ) {
        client.send('error', { message: 'Negotiation terms changed before response was registered' });
        return;
      }

      const forcedOutcome: ForcedCommitmentOutcome =
        offer.intendedOutcome === 'INSPECT' || offer.intendedOutcome === 'FORCE_INSPECT'
          ? 'FORCE_INSPECT'
          : 'FORCE_PASS';

      // Check for contradictory commitments
      const existingCommitment = this.state.pendingCommitments.find(
        (c) => c.targetBagOwnerId === offer.targetBagOwnerId
      );
      if (existingCommitment && existingCommitment.forcedOutcome !== forcedOutcome) {
        client.send('error', {
          message: `Cannot accept offer: contradicts an existing binding commitment (${existingCommitment.forcedOutcome}) for this bag`,
        });
        return;
      }

      offer.status = 'ACCEPTED';
      offer.acceptedByPlayerId = client.sessionId;
      this.state.negotiationSequence++;

      if (!existingCommitment) {
        this.state.pendingCommitments.push(
          new PendingCommitmentState({
            sourceOfferId: offer.id,
            targetBagOwnerId: offer.targetBagOwnerId,
            forcedOutcome,
          })
        );
      }

      // If activeBribe was mirrored, update its status as well
      if (this.state.activeBribe && this.state.activeBribe.id === offer.id) {
        this.state.activeBribe.status = 'ACCEPTED';
      }

      this.broadcast('negotiation_deal_struck', {
        offerId: offer.id,
        fromPlayerId: offer.fromPlayerId,
        targetBagOwnerId: offer.targetBagOwnerId,
        forcedOutcome,
        acceptedByPlayerId: client.sessionId,
      });

      // If the accepted offer concerns the merchant currently being examined at the desk,
      // immediate resolution is triggered:
      // - If forcedOutcome is 'FORCE_INSPECT' (e.g. Player B bribed to check Player A's pot), trigger inspect!
      // - If forcedOutcome is 'FORCE_PASS' (e.g. Player A bribed to let goods pass), trigger pass!
      const isCurrentlyExamined =
        this.state.activeMerchantId === offer.targetBagOwnerId ||
        this.state.currentInspectionBagOwnerId === offer.targetBagOwnerId;

      if (isCurrentlyExamined && !this.inspectedMerchantIds.has(offer.targetBagOwnerId)) {
        if (forcedOutcome === 'FORCE_INSPECT') {
          this.executeInspect(offer.targetBagOwnerId);
        } else {
          this.executePassUnopened(offer.targetBagOwnerId);
        }
      }
    });

    // 8. Decline Negotiation Offer
    this.onMessage('negotiation_decline', (client, message: DeclineNegotiationOfferMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only decline offers during INSPECTION phase' });
        return;
      }

      const offer = this.state.negotiationFeed.find((o) => o.id === message.offerId);
      if (!offer || offer.status !== 'OPEN') {
        client.send('error', { message: 'Offer is not available' });
        return;
      }

      if (offer.fromPlayerId === client.sessionId) {
        client.send('error', { message: 'Cannot decline your own offer (use withdraw instead)' });
        return;
      }

      const isAuthority =
        client.sessionId === this.state.sheriffId ||
        this.state.deputyIds.includes(client.sessionId);

      const isOfferFromAuthority =
        offer.fromPlayerId === this.state.sheriffId ||
        this.state.deputyIds.includes(offer.fromPlayerId);

      const canDecline = isOfferFromAuthority
        ? client.sessionId !== offer.fromPlayerId
        : isAuthority;

      if (!canDecline) {
        client.send('error', { message: 'Only the Sheriff or Deputy can decline negotiation offers' });
        return;
      }

      offer.status = 'DECLINED';
      this.state.negotiationSequence++;

      if (this.state.activeBribe && this.state.activeBribe.id === offer.id) {
        this.state.activeBribe.status = 'REJECTED';
      }
    });

    // 9. Withdraw Negotiation Offer
    this.onMessage('negotiation_withdraw', (client, message: WithdrawNegotiationOfferMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only withdraw offers during INSPECTION phase' });
        return;
      }

      const offer = this.state.negotiationFeed.find((o) => o.id === message.offerId);
      if (!offer || offer.status !== 'OPEN') {
        client.send('error', { message: 'Offer is not open' });
        return;
      }

      if (offer.fromPlayerId !== client.sessionId) {
        client.send('error', { message: "Cannot withdraw someone else's offer" });
        return;
      }

      offer.status = 'WITHDRAWN';
      this.state.negotiationSequence++;

      if (this.state.activeBribe && this.state.activeBribe.id === offer.id) {
        this.state.activeBribe.status = 'REJECTED';
      }
    });

    // Backward-compatible bribe_propose wrapper
    this.onMessage('bribe_propose', (client, message: BribeOfferMessage) => {
      const isSheriff = client.sessionId === this.state.sheriffId;
      const targetBagOwnerId =
        (message as any).targetBagOwnerId ||
        this.state.activeMerchantId ||
        client.sessionId;

      if (!targetBagOwnerId) {
        client.send('error', { message: 'Must select an active merchant before proposing terms' });
        return;
      }

      // Route into negotiation_propose
      const intendedOutcome =
        message.intendedOutcome ||
        (targetBagOwnerId === client.sessionId ? 'PASS' : 'INSPECT');

      const fakeMsg: ProposeNegotiationOfferMessage = {
        targetBagOwnerId,
        intendedOutcome,
        goldOffered: message.gold || 0,
        standLegalGoodsOffered: message.standCardIds || [],
        futureFavorText: message.nonBindingTerms || '',
      };
      // Trigger propose logic
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only propose bribes during INSPECTION phase' });
        return;
      }

      if (fakeMsg.goldOffered < 0 || !Number.isInteger(fakeMsg.goldOffered)) {
        client.send('error', { message: 'Bribe gold must be a non-negative integer' });
        return;
      }

      if (isSheriff) {
        const targetMerchant = this.state.players.get(targetBagOwnerId);
        if (targetMerchant && fakeMsg.goldOffered > targetMerchant.gold) {
          client.send('error', { message: 'Cannot demand more gold than the merchant holds' });
          return;
        }
      } else {
        if (fakeMsg.goldOffered > player.gold) {
          client.send('error', { message: 'Cannot offer more gold than you currently hold' });
          return;
        }
        if (message.standCardIds && message.standCardIds.length > 0) {
          const standLegalIds = new Set(player.standLegal.map((c) => c.id));
          for (const cardId of message.standCardIds) {
            if (!standLegalIds.has(cardId)) {
              client.send('error', { message: `Card ${cardId} is not on your legal stand` });
              return;
            }
          }
        }
      }

      this.state.negotiationSequence++;
      this.bribeSequenceNumber = this.state.negotiationSequence;

      const offerState = new NegotiationOfferState({
        id: `offer_${this.state.negotiationSequence}`,
        fromPlayerId: client.sessionId,
        targetBagOwnerId,
        intendedOutcome,
        goldOffered: fakeMsg.goldOffered,
        standLegalGoodsOffered: fakeMsg.standLegalGoodsOffered || [],
        standContrabandCountOffered: 0,
        bagGoodsCountOffered: 0,
        futureFavorText: fakeMsg.futureFavorText || '',
        status: 'OPEN',
        acceptedByPlayerId: '',
        sequence: this.state.negotiationSequence,
        timestamp: Date.now(),
      });

      this.state.negotiationFeed.push(offerState);

      const bribeState = new BribeOfferState({
        id: offerState.id,
        sequenceNumber: this.state.negotiationSequence,
        fromPlayerId: client.sessionId,
        toPlayerId: isSheriff ? targetBagOwnerId : this.state.sheriffId,
        gold: fakeMsg.goldOffered,
        standCardIds: fakeMsg.standLegalGoodsOffered || [],
        bagCardClaims: (message.bagCardClaims || []).map((c) => JSON.stringify(c)),
        nonBindingTerms: message.nonBindingTerms || '',
        status: 'PROPOSED',
        createdAt: Date.now(),
      });

      this.state.activeBribe = bribeState;
      const merchantKey = targetBagOwnerId;
      const existingIdx = this.state.bribeOffers.findIndex(
        (b) => b.fromPlayerId === merchantKey || b.toPlayerId === merchantKey || b.id === bribeState.id
      );
      if (existingIdx !== -1) {
        this.state.bribeOffers[existingIdx] = bribeState;
      } else {
        this.state.bribeOffers.push(bribeState);
      }

      // Non-blocking toast notification for cross-bag offers
      if (targetBagOwnerId !== client.sessionId) {
        const targetPlayer = this.state.players.get(targetBagOwnerId);
        this.broadcast('negotiation_cross_bag_toast', {
          fromPlayerId: client.sessionId,
          fromPlayerName: player.name,
          targetBagOwnerId,
          targetPlayerName: targetPlayer?.name || 'Merchant',
          goldOffered: fakeMsg.goldOffered,
          intendedOutcome,
        });
      }
    });

    // Backward-compatible bribe_respond wrapper
    this.onMessage('bribe_respond', (client, message: BribeResponseMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only respond to bribes during INSPECTION phase' });
        return;
      }
      if (!this.state.activeBribe || this.state.activeBribe.status !== 'PROPOSED') {
        client.send('error', { message: 'No active bribe offer to respond to' });
        return;
      }

      if (this.state.activeBribe.fromPlayerId === client.sessionId) {
        client.send('error', { message: 'Cannot respond to your own bribe offer' });
        return;
      }

      if (
        message.sequenceNumber !== undefined &&
        message.sequenceNumber !== this.state.activeBribe.sequenceNumber
      ) {
        client.send('error', { message: 'Bribe offer terms changed before response was registered' });
        return;
      }

      if (!message.accept) {
        this.state.activeBribe.status = 'REJECTED';
        const feedOffer = this.state.negotiationFeed.find((o) => o.id === this.state.activeBribe!.id);
        if (feedOffer) feedOffer.status = 'DECLINED';
        return;
      }

      this.state.activeBribe.status = 'ACCEPTED';
      const feedOffer = this.state.negotiationFeed.find((o) => o.id === this.state.activeBribe!.id);
      if (feedOffer) {
        feedOffer.status = 'ACCEPTED';
        feedOffer.acceptedByPlayerId = client.sessionId;
      }

      const isSheriffOffer = this.state.activeBribe.fromPlayerId === this.state.sheriffId;
      const merchantId =
        feedOffer?.targetBagOwnerId ||
        this.state.activeMerchantId ||
        (isSheriffOffer
          ? (this.state.activeBribe.toPlayerId || this.state.activeMerchantId)
          : this.state.activeBribe.fromPlayerId);

      if (!merchantId || !this.state.players.has(merchantId)) {
        client.send('error', { message: 'Target merchant not found' });
        return;
      }

      if (feedOffer?.intendedOutcome === 'FORCE_INSPECT' || feedOffer?.intendedOutcome === 'INSPECT') {
        this.executeInspect(merchantId);
      } else {
        this.executePassUnopened(merchantId, {
          gold: this.state.activeBribe.gold,
          standCardIds: [...this.state.activeBribe.standCardIds],
          bagGoodsClaims: this.state.activeBribe.bagCardClaims.map((str) => JSON.parse(str)),
        });
      }
    });

    // 8. Inspection Action (Sheriff or Deputy: PASS or INSPECT)
    this.onMessage('inspection_action', (client, message: InspectionAction) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only inspect during INSPECTION phase' });
        return;
      }
      const isAuthority =
        client.sessionId === this.state.sheriffId ||
        this.state.deputyIds.includes(client.sessionId);
      if (!isAuthority) {
        client.send('error', { message: 'Only the Sheriff or Deputy can inspect merchant bags' });
        return;
      }

      const targetMerchantId = message.targetPlayerId;
      if (!this.state.players.has(targetMerchantId) || targetMerchantId === client.sessionId) {
        client.send('error', { message: 'Invalid target merchant for inspection' });
        return;
      }
      if (this.inspectedMerchantIds.has(targetMerchantId)) {
        client.send('error', { message: 'Merchant has already been inspected this round' });
        return;
      }

      // Enforce binding pending commitments (e.g. Rival paid Sheriff to guarantee inspection)
      const commitment = this.state.pendingCommitments.find(
        (c) => c.targetBagOwnerId === targetMerchantId
      );
      if (commitment) {
        if (commitment.forcedOutcome === 'FORCE_INSPECT') {
          this.executeInspect(targetMerchantId);
          return;
        }
        if (commitment.forcedOutcome === 'FORCE_PASS') {
          this.executePassUnopened(targetMerchantId);
          return;
        }
      }

      if (this.state.enableDeputies && this.state.deputyIds.length === 2) {
        this.executeDeputyInspection(
          message.type === 'PASS' ? 'JOINT_PASS' : 'JOINT_INSPECT',
          client.sessionId,
          targetMerchantId
        );
      } else {
        if (message.type === 'PASS') {
          this.executePassUnopened(targetMerchantId);
        } else {
          this.executeInspect(targetMerchantId);
        }
      }
    });

    // 9. Select Merchant to Examine (Sheriff or Deputy sets active merchant for 1-on-1 inspection desk view)
    this.onMessage('select_inspect_merchant', (client, message: SelectInspectMerchantMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only select merchant during INSPECTION phase' });
        return;
      }
      const isAuthority =
        client.sessionId === this.state.sheriffId ||
        this.state.deputyIds.includes(client.sessionId);
      if (!isAuthority) {
        client.send('error', { message: 'Only the Sheriff or Deputy can select merchants for examination' });
        return;
      }
      if (!this.state.players.has(message.targetPlayerId) || message.targetPlayerId === client.sessionId) {
        client.send('error', { message: 'Invalid target merchant' });
        return;
      }
      if (this.inspectedMerchantIds.has(message.targetPlayerId)) {
        client.send('error', { message: 'Merchant has already been inspected this round' });
        return;
      }
      this.state.activeMerchantId = message.targetPlayerId;
      this.state.currentInspectionBagOwnerId = message.targetPlayerId;
      const merchantOffer = this.state.bribeOffers.find(
        (b) => b.fromPlayerId === message.targetPlayerId || b.toPlayerId === message.targetPlayerId
      );
      this.state.activeBribe = merchantOffer || undefined;
    });

    // 10. Start Game from Lobby (Host)
    this.onMessage('startGame', (client) => {
      if (this.state.phase !== 'LOBBY') {
        client.send('error', { message: 'Game has already started' });
        return;
      }
      if (this.tableSeatIds[0] !== client.sessionId) {
        client.send('error', { message: 'Only the lobby host can start the game' });
        return;
      }
      if (this.state.players.size < 3) {
        client.send('error', { message: 'At least 3 players are required to start' });
        return;
      }
      let allReady = true;
      this.state.players.forEach((p) => {
        if (!p.ready) allReady = false;
      });
      if (!allReady) {
        client.send('error', { message: 'All players must be ready to start' });
        return;
      }
      this.startGame();
    });

    // 11. Update Lobby Options (Host only)
    this.onMessage('update_lobby_options', (client, message: UpdateLobbyOptionsMessage) => {
      if (this.state.phase !== 'LOBBY') {
        client.send('error', { message: 'Cannot change lobby options after game has started' });
        return;
      }
      if (this.tableSeatIds[0] !== client.sessionId) {
        client.send('error', { message: 'Only the lobby host can change settings' });
        return;
      }

      if (message.enableRoyalGoods !== undefined) {
        this.state.enableRoyalGoods = message.enableRoyalGoods;
      }
      if (message.enableDeputies !== undefined) {
        this.state.enableDeputies = message.enableDeputies;
      }
      if (message.enableBlackMarket !== undefined) {
        this.state.enableBlackMarket = message.enableBlackMarket;
      }
      if (message.maxPlayers !== undefined) {
        if (message.maxPlayers >= 3 && message.maxPlayers <= 6) {
          this.state.maxPlayers = message.maxPlayers;
        } else {
          client.send('error', { message: 'maxPlayers must be between 3 and 6' });
          return;
        }
      }
    });

    // 12. 6-Player Deputy Inspection Actions
    this.onMessage('deputy_inspection', (client, message: DeputyInspectionMessage) => {
      if (this.state.phase !== 'INSPECTION') {
        client.send('error', { message: 'Can only take deputy actions during INSPECTION phase' });
        return;
      }
      if (!this.state.enableDeputies) {
        client.send('error', { message: 'Deputies expansion is not enabled' });
        return;
      }
      if (!this.state.deputyIds.includes(client.sessionId)) {
        client.send('error', { message: 'Only designated deputies can take deputy inspection actions' });
        return;
      }
      if (!this.state.players.has(message.targetPlayerId) || message.targetPlayerId === client.sessionId) {
        client.send('error', { message: 'Invalid target merchant' });
        return;
      }
      if (this.inspectedMerchantIds.has(message.targetPlayerId)) {
        client.send('error', { message: 'Merchant has already been inspected this round' });
        return;
      }

      this.executeDeputyInspection(message.type, client.sessionId, message.targetPlayerId);
    });

    // 13. Black Market Order Claim
    this.onMessage('claim_black_market', (client, message: ClaimBlackMarketMessage) => {
      if (!this.state.enableBlackMarket || !this.blackMarketEngineState) {
        client.send('error', { message: 'Black Market expansion is not enabled' });
        return;
      }
      if (this.state.phase !== 'INSPECTION' && this.state.phase !== 'ROUND_END') {
        client.send('error', { message: 'Can only claim Black Market orders after inspection' });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const standContrabandCards = player.standContraband.map(stateToCard);
      const check = canClaimBlackMarketOrder(
        this.blackMarketEngineState,
        client.sessionId,
        message.contrabandType,
        standContrabandCards
      );

      if (!check.canClaim || !check.topCard) {
        client.send('error', { message: check.reason || 'Cannot claim Black Market order' });
        return;
      }

      const claimResult = claimBlackMarketOrder(
        this.blackMarketEngineState,
        client.sessionId,
        message.contrabandType,
        standContrabandCards
      );

      this.blackMarketEngineState = claimResult.nextState;
      syncBlackMarketPiles(this.state, this.blackMarketEngineState);
      player.hasClaimedBlackMarketThisRound = true;

      // Discard 3 traded contraband cards
      for (const card of claimResult.discardedCards) {
        this.internalDiscardPile.push(card);
        this.state.discardPile.push(cardToState(card));
      }

      // Update standContraband
      player.standContraband.clear();
      for (const card of claimResult.updatedStandContraband) {
        const cs = cardToState(card);
        player.standContraband.push(cs);
        if (client.view) client.view.add(cs);
      }

      // Add claimed Black Market card as high-value contraband
      const claimedCard: Card = {
        id: claimResult.claimedCard.id,
        name: claimResult.claimedCard.name,
        classification: 'CONTRABAND',
        contrabandType: claimResult.claimedCard.contrabandType,
        value: claimResult.claimedCard.pointsValue,
        penalty: 4,
      };

      const claimedState = cardToState(claimedCard);
      player.standContraband.push(claimedState);
      if (client.view) client.view.add(claimedState);
      player.standContrabandCount = player.standContraband.length;

      this.broadcast('black_market_claimed', {
        playerId: player.id,
        playerName: player.name,
        orderId: claimResult.claimedCard.id,
        orderName: claimResult.claimedCard.name,
        contrabandType: claimResult.claimedCard.contrabandType,
        pointsValue: claimResult.claimedCard.pointsValue,
      });
    });
  }

  private startGame() {
    const playerCount = this.state.players.size;

    this.internalDrawPile = shuffleDeck(
      buildDeck({
        playerCount,
        enableRoyalGoods: this.state.enableRoyalGoods,
      })
    );
    this.internalDiscardPile = [];

    const is6pDeputies = this.state.enableDeputies && playerCount === 6;
    let initialSheriffId = this.tableSeatIds[0];

    if (is6pDeputies) {
      this.deputiesEngineState = initDeputiesState(this.tableSeatIds);
      this.state.bootyTile = new BootyTileState({ gold: 0 });
      const drawResult = drawDeputiesForRound(this.deputiesEngineState);
      this.deputiesEngineState = drawResult.nextState;

      this.state.deputyIds.clear();
      this.state.deputyIds.push(drawResult.deputies[0], drawResult.deputies[1]);
      initialSheriffId = drawResult.deputies[0];
    }

    if (this.state.enableBlackMarket) {
      this.blackMarketEngineState = initBlackMarketState();
      syncBlackMarketPiles(this.state, this.blackMarketEngineState);
    }

    this.state.sheriffId = initialSheriffId;
    this.state.round = 1;

    const effectivePlayerCount = this.tableSeatIds.length;
    const requiredSheriffTurns =
      this.optionsSheriffRounds ||
      SHERIFF_ROUNDS_BY_PLAYER_COUNT[effectivePlayerCount] ||
      2;
    this.state.sheriffRounds = requiredSheriffTurns;
    this.state.totalRounds = is6pDeputies ? 9 : (requiredSheriffTurns * effectivePlayerCount);

    // Deal starting hands
    const { hands, remainingDeck } = dealStartingHands(this.internalDrawPile, this.tableSeatIds, 6);
    this.internalDrawPile = remainingDeck;
    this.state.drawPileCount = remainingDeck.length;

    this.tableSeatIds.forEach((id) => {
      const player = this.state.players.get(id)!;
      if (is6pDeputies) {
        player.isDeputy = this.state.deputyIds.includes(id);
        player.isSheriff = false;
      } else {
        player.isSheriff = id === initialSheriffId;
        player.isDeputy = false;
      }
      player.hand.clear();
      const client = this.clients.find((c) => c.sessionId === id);
      for (const card of hands[id]) {
        const cs = cardToState(card);
        player.hand.push(cs);
        if (client?.view) {
          client.view.add(cs);
        }
      }
      player.handCount = hands[id].length;
    });

    this.startMarketPhase();
  }

  private startMarketPhase() {
    this.state.phase = 'MARKET';
    const is6pDeputies = this.state.enableDeputies && this.tableSeatIds.length === 6;
    this.marketState = initMarketPhase({
      tableSeats: this.tableSeatIds,
      sheriffId: this.state.sheriffId,
      deputyIds: is6pDeputies ? Array.from(this.state.deputyIds) : undefined,
    });
    this.state.activeMerchantId = getCurrentMarketMerchant(this.marketState) || '';
  }

  private startLoadBagPhase() {
    this.state.phase = 'LOAD_BAG';
    this.state.activeMerchantId = '';
  }

  private startDeclarationPhase() {
    this.state.phase = 'DECLARATION';
    const is6pDeputies = this.state.enableDeputies && this.tableSeatIds.length === 6;
    this.declarationOrder = getDeclarationOrder(
      this.tableSeatIds,
      this.state.sheriffId,
      is6pDeputies ? Array.from(this.state.deputyIds) : undefined
    );
    this.declarationIndex = 0;
    this.state.activeMerchantId = '';
  }

  private startInspectionPhase() {
    this.state.phase = 'INSPECTION';
    this.state.activeMerchantId = '';
    this.state.currentInspectionBagOwnerId = '';
    this.inspectedMerchantIds.clear();
    this.state.activeBribe = undefined;
    this.state.bribeOffers.clear();
    this.state.negotiationFeed.clear();
    this.state.pendingCommitments.clear();
    this.state.negotiationSequence = 1;
    this.bribeSequenceNumber = 1;
  }

  private revealBagToAll(bag: SealedBagState) {
    bag.isRevealed = true;
    // Reveal to all clients by adding to each client's view
    this.clients.forEach((c) => {
      if (c.view) {
        c.view.add(bag);
        c.view.subscribe(bag.cards);
        for (const card of bag.cards) {
          c.view.add(card);
        }
      }
    });
  }

  private reconcileAndExecuteBribesForBag(
    targetMerchantId: string,
    outcome: 'PASS' | 'INSPECT'
  ): BribeReconciliationRecord[] {
    const merchant = this.state.players.get(targetMerchantId);
    if (!merchant) return [];

    const sheriff = this.state.players.get(this.state.sheriffId);
    if (!sheriff) return [];

    // Mark all remaining OPEN offers targeting this bag as VOIDED
    for (const offer of this.state.negotiationFeed) {
      if (offer.targetBagOwnerId === targetMerchantId && offer.status === 'OPEN') {
        offer.status = 'VOIDED';
      }
    }

    // Find all ACCEPTED offers targeting this bag
    const acceptedOffers = this.state.negotiationFeed.filter(
      (o) => o.targetBagOwnerId === targetMerchantId && o.status === 'ACCEPTED'
    );

    const reconciliationRecords: BribeReconciliationRecord[] = [];

    for (const offer of acceptedOffers) {
      const isOfferFromAuthority =
        offer.fromPlayerId === this.state.sheriffId ||
        this.state.deputyIds.includes(offer.fromPlayerId);

      // The payer of a bribe is ALWAYS a merchant:
      // - If Sheriff proposed/demanded: the merchant who agreed to pay (acceptedByPlayerId or targetBagOwnerId)
      // - If Merchant proposed: the merchant who proposed (fromPlayerId)
      const payer = isOfferFromAuthority
        ? this.state.players.get(offer.acceptedByPlayerId || offer.targetBagOwnerId)
        : this.state.players.get(offer.fromPlayerId);

      if (!payer) continue;

      // In 6p Deputies mode with communal booty tile, joint deals go to booty tile
      const isJointDeputy =
        this.state.enableDeputies &&
        this.state.bootyTile &&
        (this.state.deputyIds.includes(offer.acceptedByPlayerId || '') ||
         this.state.deputyIds.includes(offer.fromPlayerId));

      const recipient = sheriff;

      // 1. Reconcile Gold: Payer (merchant) pays, Recipient (sheriff) receives!
      const genuineGold = Math.min(Math.max(0, payer.gold), offer.goldOffered);
      payer.gold -= genuineGold;

      if (isJointDeputy && this.state.bootyTile) {
        this.state.bootyTile.gold += genuineGold;
      } else {
        recipient.gold += genuineGold;
      }

      // 2. Reconcile Stand Legal Goods
      let honoredLegalCount = 0;
      for (const cardId of offer.standLegalGoodsOffered) {
        const idx = payer.standLegal.findIndex((c) => c.id === cardId);
        if (idx !== -1) {
          const [cardState] = payer.standLegal.splice(idx, 1);
          recipient.standLegal.push(cardState);
          honoredLegalCount++;
        }
      }

      // 3. Reconcile Stand Contraband (Honor Among Thieves: phantom contraband voided)
      const availableContraband = payer.standContraband.length;
      const genuineContrabandCount = Math.min(availableContraband, offer.standContrabandCountOffered);
      const voidedContrabandCount = offer.standContrabandCountOffered - genuineContrabandCount;

      for (let i = 0; i < genuineContrabandCount; i++) {
        const cs = payer.standContraband.pop();
        if (cs) {
          payer.standContrabandCount = payer.standContraband.length;
          // Revealed contraband moves to recipient stand
          recipient.standLegal.push(cs);
        }
      }

      // 4. Reconcile Bag Goods (Honor Among Thieves: phantom bag cards voided)
      let genuineBagCount = 0;
      let voidedBagCount = offer.bagGoodsCountOffered;

      if (payer.id === targetMerchantId && merchant.sealedBag) {
        // Merchant whose bag is resolving promised cards from this bag
        if (outcome === 'PASS') {
          const availableInBag = merchant.sealedBag.cards.length;
          genuineBagCount = Math.min(availableInBag, offer.bagGoodsCountOffered);
          voidedBagCount = offer.bagGoodsCountOffered - genuineBagCount;

          for (let i = 0; i < genuineBagCount; i++) {
            const cs = merchant.sealedBag.cards.pop();
            if (cs) {
              merchant.sealedBag.cardCount = merchant.sealedBag.cards.length;
              recipient.standLegal.push(cs);
            }
          }
        }
      }

      const summaryParts: string[] = [];
      if (genuineGold > 0) summaryParts.push(`${genuineGold} Gold`);
      if (honoredLegalCount > 0) summaryParts.push(`${honoredLegalCount} Legal Goods`);
      if (genuineContrabandCount > 0) summaryParts.push(`${genuineContrabandCount} Contraband`);
      if (genuineBagCount > 0) summaryParts.push(`${genuineBagCount} Bag Cards`);

      const voidedParts: string[] = [];
      if (voidedContrabandCount > 0) voidedParts.push(`${voidedContrabandCount} promised contraband did not exist — voided`);
      if (voidedBagCount > 0) voidedParts.push(`${voidedBagCount} promised bag cards did not exist — voided`);

      const summaryText =
        (summaryParts.length > 0 ? `Deal honored: ${summaryParts.join(' + ')}.` : 'No genuine goods to transfer.') +
        (voidedParts.length > 0 ? ` (${voidedParts.join(', ')})` : '');

      const record: BribeReconciliationRecord = {
        offerId: offer.id,
        fromPlayerId: payer.id,
        targetBagOwnerId: targetMerchantId,
        honoredGold: genuineGold,
        honoredLegalCardsCount: honoredLegalCount,
        honoredContrabandCount: genuineContrabandCount,
        honoredBagCardsCount: genuineBagCount,
        voidedContrabandCount,
        voidedBagCardsCount: voidedBagCount,
        summaryText,
      };

      reconciliationRecords.push(record);
      this.broadcast('negotiation_reconciled', record);
    }

    return reconciliationRecords;
  }

  private executePassUnopened(merchantId: string, bribe?: any) {
    const merchant = this.state.players.get(merchantId)!;
    const sheriff = this.state.players.get(this.state.sheriffId)!;

    // Check binding commitments: If committed to FORCE_INSPECT, Sheriff cannot pass!
    const commitment = this.state.pendingCommitments.find((c) => c.targetBagOwnerId === merchantId);
    if (commitment && commitment.forcedOutcome === 'FORCE_INSPECT') {
      this.executeInspect(merchantId);
      return;
    }

    // Reconcile and apply all accepted negotiation feed bribes targeting this bag
    const reconciliations = this.reconcileAndExecuteBribesForBag(merchantId, 'PASS');

    const bagCards = merchant.sealedBag!.cards.map(stateToCard);
    const standCards = merchant.standLegal.map(stateToCard);

    const result = resolvePassUnopened(bagCards, bribe, standCards);

    // Apply legacy bribe transfers only if not already handled by negotiation feed reconciliations
    if (reconciliations.length === 0) {
      if (result.merchantPaidGold > 0) {
        merchant.gold -= result.merchantPaidGold;
        sheriff.gold += result.merchantPaidGold;
      }

      for (const card of result.merchantTransferredStandCards) {
        const idx = merchant.standLegal.findIndex((c) => c.id === card.id);
        if (idx !== -1) merchant.standLegal.splice(idx, 1);
        sheriff.standLegal.push(cardToState(card));
      }

      for (const card of result.sheriffReceivedBagCards) {
        sheriff.standLegal.push(cardToState(card));
      }
    }

    // Move remaining legal cards to merchant stand
    for (const card of result.merchantKeptLegalCards) {
      merchant.standLegal.push(cardToState(card));
    }

    // Move contraband & royal goods to merchant stand (face down)
    for (const card of result.merchantKeptContrabandCards) {
      if (card.classification === 'ROYAL') {
        const cs = cardToState(card);
        merchant.standRoyal.push(cs);
        merchant.standRoyalCount++;
        const client = this.clients.find((c) => c.sessionId === merchant.id);
        if (client?.view) client.view.add(cs);
      } else {
        const cs = cardToState(card);
        merchant.standContraband.push(cs);
        merchant.standContrabandCount++;
        const client = this.clients.find((c) => c.sessionId === merchant.id);
        if (client?.view) client.view.add(cs);
      }
    }

    this.revealBagToAll(merchant.sealedBag!);
    this.inspectedMerchantIds.add(merchantId);

    if (this.state.activeMerchantId === merchantId) {
      this.state.activeMerchantId = '';
    }
    if (this.state.currentInspectionBagOwnerId === merchantId) {
      this.state.currentInspectionBagOwnerId = '';
    }
    for (let i = this.state.bribeOffers.length - 1; i >= 0; i--) {
      const b = this.state.bribeOffers[i];
      if (b.fromPlayerId === merchantId || b.toPlayerId === merchantId) {
        this.state.bribeOffers.splice(i, 1);
      }
    }
    this.state.activeBribe = undefined;

    const totalPaidGold =
      reconciliations.reduce((s, r) => s + r.honoredGold, 0) +
      (reconciliations.length === 0 ? result.merchantPaidGold : 0);

    this.broadcast('inspection_result', {
      outcome: 'PASS',
      targetPlayerId: merchantId,
      targetPlayerName: merchant.name,
      sheriffId: sheriff.id,
      sheriffName: sheriff.name,
      declaredGood: merchant.sealedBag?.declaredGood || '',
      declaredCount: merchant.sealedBag?.declaredCount || 0,
      penaltyAmount: 0,
      keptCardsCount: result.merchantKeptLegalCards.length + result.merchantKeptContrabandCards.length,
      confiscatedCardsCount: 0,
      debtSettled: true,
      debtPaidGold: totalPaidGold,
      debtForgiven: 0,
      revealedCards: bagCards,
    });

    this.checkInspectionCompletion();
  }

  private executeDeputyInspection(
    type: 'JOINT_PASS' | 'JOINT_INSPECT' | 'SOLO_PASS' | 'SOLO_INSPECT',
    actingDeputyId: string,
    merchantId: string
  ) {
    const merchant = this.state.players.get(merchantId)!;
    const dep1 = this.state.players.get(this.state.deputyIds[0])!;
    const dep2 = this.state.players.get(this.state.deputyIds[1])!;
    const actingDeputy = this.state.players.get(actingDeputyId)!;

    const bagCards = merchant.sealedBag!.cards.map(stateToCard);
    const declaredGood = merchant.sealedBag!.declaredGood as GoodType;
    const declaredCount = merchant.sealedBag!.declaredCount;

    let bribe: any = undefined;
    if (this.state.activeBribe && this.state.activeBribe.fromPlayerId === merchantId) {
      bribe = {
        gold: this.state.activeBribe.gold,
        standCardIds: [...this.state.activeBribe.standCardIds],
        bagGoodsClaims: this.state.activeBribe.bagCardClaims.map((str) => JSON.parse(str)),
      };
    }

    if (type === 'JOINT_PASS') {
      const standCards = merchant.standLegal.map(stateToCard);
      const result = resolvePassUnopened(bagCards, bribe, standCards);

      if (result.merchantPaidGold > 0) {
        merchant.gold -= result.merchantPaidGold;
        if (this.state.bootyTile) {
          this.state.bootyTile.gold += result.merchantPaidGold;
        }
      }

      for (const card of result.merchantTransferredStandCards) {
        const idx = merchant.standLegal.findIndex((c) => c.id === card.id);
        if (idx !== -1) merchant.standLegal.splice(idx, 1);
        if (this.state.bootyTile) {
          this.state.bootyTile.goods.push(cardToState(card));
        }
      }

      for (const card of result.sheriffReceivedBagCards) {
        if (this.state.bootyTile) {
          this.state.bootyTile.goods.push(cardToState(card));
        }
      }

      for (const card of result.merchantKeptLegalCards) {
        merchant.standLegal.push(cardToState(card));
      }

      for (const card of result.merchantKeptContrabandCards) {
        if (card.classification === 'ROYAL') {
          const cs = cardToState(card);
          merchant.standRoyal.push(cs);
          merchant.standRoyalCount++;
          const client = this.clients.find((c) => c.sessionId === merchant.id);
          if (client?.view) client.view.add(cs);
        } else {
          const cs = cardToState(card);
          merchant.standContraband.push(cs);
          merchant.standContrabandCount++;
          const client = this.clients.find((c) => c.sessionId === merchant.id);
          if (client?.view) client.view.add(cs);
        }
      }

      this.revealBagToAll(merchant.sealedBag!);
      this.inspectedMerchantIds.add(merchantId);
      if (this.state.activeMerchantId === merchantId) this.state.activeMerchantId = '';

      this.broadcast('inspection_result', {
        outcome: 'PASS',
        targetPlayerId: merchantId,
        targetPlayerName: merchant.name,
        sheriffId: dep1.id,
        sheriffName: `${dep1.name} & ${dep2.name} (Deputies)`,
        declaredGood: merchant.sealedBag?.declaredGood || '',
        declaredCount: merchant.sealedBag?.declaredCount || 0,
        penaltyAmount: 0,
        keptCardsCount: result.merchantKeptLegalCards.length + result.merchantKeptContrabandCards.length,
        confiscatedCardsCount: 0,
        debtSettled: true,
        debtPaidGold: result.merchantPaidGold,
        debtForgiven: 0,
        revealedCards: bagCards,
      });

      this.checkInspectionCompletion();
    } else if (type === 'SOLO_PASS') {
      const standCards = merchant.standLegal.map(stateToCard);
      const result = resolvePassUnopened(bagCards, bribe, standCards);

      if (result.merchantPaidGold > 0) {
        merchant.gold -= result.merchantPaidGold;
        actingDeputy.gold += result.merchantPaidGold;
      }

      for (const card of result.merchantTransferredStandCards) {
        const idx = merchant.standLegal.findIndex((c) => c.id === card.id);
        if (idx !== -1) merchant.standLegal.splice(idx, 1);
        actingDeputy.standLegal.push(cardToState(card));
      }

      for (const card of result.sheriffReceivedBagCards) {
        actingDeputy.standLegal.push(cardToState(card));
      }

      for (const card of result.merchantKeptLegalCards) merchant.standLegal.push(cardToState(card));
      for (const card of result.merchantKeptContrabandCards) {
        if (card.classification === 'ROYAL') {
          const cs = cardToState(card);
          merchant.standRoyal.push(cs);
          merchant.standRoyalCount++;
          const client = this.clients.find((c) => c.sessionId === merchant.id);
          if (client?.view) client.view.add(cs);
        } else {
          const cs = cardToState(card);
          merchant.standContraband.push(cs);
          merchant.standContrabandCount++;
          const client = this.clients.find((c) => c.sessionId === merchant.id);
          if (client?.view) client.view.add(cs);
        }
      }

      this.revealBagToAll(merchant.sealedBag!);
      this.inspectedMerchantIds.add(merchantId);
      if (this.state.activeMerchantId === merchantId) this.state.activeMerchantId = '';

      this.broadcast('inspection_result', {
        outcome: 'PASS',
        targetPlayerId: merchantId,
        targetPlayerName: merchant.name,
        sheriffId: actingDeputy.id,
        sheriffName: `${actingDeputy.name} (Solo Deputy)`,
        declaredGood: merchant.sealedBag?.declaredGood || '',
        declaredCount: merchant.sealedBag?.declaredCount || 0,
        penaltyAmount: 0,
        keptCardsCount: result.merchantKeptLegalCards.length + result.merchantKeptContrabandCards.length,
        confiscatedCardsCount: 0,
        debtSettled: true,
        debtPaidGold: result.merchantPaidGold,
        debtForgiven: 0,
        revealedCards: bagCards,
      });

      this.checkInspectionCompletion();
    } else if (type === 'JOINT_INSPECT') {
      const result = resolveInspection(bagCards, declaredGood, declaredCount);
      this.revealBagToAll(merchant.sealedBag!);

      if (result.isHonest) {
        for (const card of result.merchantKeptCards) {
          merchant.standLegal.push(cardToState(card));
        }

        const half = Math.floor(result.penaltyAmount / 2);
        const remainder = result.penaltyAmount % 2;
        const dep1Penalty = half + remainder;
        const dep2Penalty = half;

        const debt1 = resolveDebt(
          { id: dep1.id, gold: dep1.gold, standLegal: dep1.standLegal.map(stateToCard), standContraband: dep1.standContraband.map(stateToCard) },
          { id: merchant.id, gold: merchant.gold, standLegal: merchant.standLegal.map(stateToCard), standContraband: merchant.standContraband.map(stateToCard) },
          dep1Penalty
        );
        dep1.gold = debt1.debtor.gold;
        merchant.gold = debt1.creditor.gold;

        const debt2 = resolveDebt(
          { id: dep2.id, gold: dep2.gold, standLegal: dep2.standLegal.map(stateToCard), standContraband: dep2.standContraband.map(stateToCard) },
          { id: merchant.id, gold: merchant.gold, standLegal: merchant.standLegal.map(stateToCard), standContraband: merchant.standContraband.map(stateToCard) },
          dep2Penalty
        );
        dep2.gold = debt2.debtor.gold;
        merchant.gold = debt2.creditor.gold;
      } else {
        for (const card of result.merchantKeptCards) {
          merchant.standLegal.push(cardToState(card));
        }
        for (const card of result.confiscatedCards) {
          this.internalDiscardPile.push(card);
          this.state.discardPile.push(cardToState(card));
        }
        const finePaid = Math.min(merchant.gold, result.penaltyAmount);
        merchant.gold -= finePaid;
        if (this.state.bootyTile) {
          this.state.bootyTile.gold += finePaid;
        }
      }

      this.inspectedMerchantIds.add(merchantId);
      if (this.state.activeMerchantId === merchantId) this.state.activeMerchantId = '';

      this.broadcast('inspection_result', {
        outcome: result.isHonest ? 'HONEST' : 'DISHONEST',
        targetPlayerId: merchantId,
        targetPlayerName: merchant.name,
        sheriffId: dep1.id,
        sheriffName: `${dep1.name} & ${dep2.name} (Deputies)`,
        declaredGood,
        declaredCount,
        penaltyAmount: result.penaltyAmount,
        keptCardsCount: result.merchantKeptCards.length,
        confiscatedCardsCount: result.confiscatedCards.length,
        debtSettled: true,
        debtPaidGold: result.penaltyAmount,
        debtForgiven: 0,
        revealedCards: bagCards,
      });

      this.checkInspectionCompletion();
    } else if (type === 'SOLO_INSPECT') {
      const result = resolveInspection(bagCards, declaredGood, declaredCount);
      this.revealBagToAll(merchant.sealedBag!);

      if (result.isHonest) {
        for (const card of result.merchantKeptCards) merchant.standLegal.push(cardToState(card));
        const debt = resolveDebt(
          { id: actingDeputy.id, gold: actingDeputy.gold, standLegal: actingDeputy.standLegal.map(stateToCard), standContraband: actingDeputy.standContraband.map(stateToCard) },
          { id: merchant.id, gold: merchant.gold, standLegal: merchant.standLegal.map(stateToCard), standContraband: merchant.standContraband.map(stateToCard) },
          result.penaltyAmount
        );
        actingDeputy.gold = debt.debtor.gold;
        merchant.gold = debt.creditor.gold;
      } else {
        for (const card of result.merchantKeptCards) merchant.standLegal.push(cardToState(card));
        for (const card of result.confiscatedCards) {
          this.internalDiscardPile.push(card);
          this.state.discardPile.push(cardToState(card));
        }
        const debt = resolveDebt(
          { id: merchant.id, gold: merchant.gold, standLegal: merchant.standLegal.map(stateToCard), standContraband: merchant.standContraband.map(stateToCard) },
          { id: actingDeputy.id, gold: actingDeputy.gold, standLegal: actingDeputy.standLegal.map(stateToCard), standContraband: actingDeputy.standContraband.map(stateToCard) },
          result.penaltyAmount
        );
        merchant.gold = debt.debtor.gold;
        actingDeputy.gold = debt.creditor.gold;
      }

      this.inspectedMerchantIds.add(merchantId);
      if (this.state.activeMerchantId === merchantId) this.state.activeMerchantId = '';

      this.broadcast('inspection_result', {
        outcome: result.isHonest ? 'HONEST' : 'DISHONEST',
        targetPlayerId: merchantId,
        targetPlayerName: merchant.name,
        sheriffId: actingDeputy.id,
        sheriffName: `${actingDeputy.name} (Solo Deputy)`,
        declaredGood,
        declaredCount,
        penaltyAmount: result.penaltyAmount,
        keptCardsCount: result.merchantKeptCards.length,
        confiscatedCardsCount: result.confiscatedCards.length,
        debtSettled: true,
        debtPaidGold: result.penaltyAmount,
        debtForgiven: 0,
        revealedCards: bagCards,
      });

      this.checkInspectionCompletion();
    }
  }

  private executeInspect(merchantId: string) {
    const merchant = this.state.players.get(merchantId)!;
    const sheriff = this.state.players.get(this.state.sheriffId)!;

    // Check binding commitments: If committed to FORCE_PASS, Sheriff cannot inspect!
    const commitment = this.state.pendingCommitments.find((c) => c.targetBagOwnerId === merchantId);
    if (commitment && commitment.forcedOutcome === 'FORCE_PASS') {
      this.executePassUnopened(merchantId);
      return;
    }

    const bagCards = merchant.sealedBag!.cards.map(stateToCard);
    const declaredGood = merchant.sealedBag!.declaredGood as GoodType;
    const declaredCount = merchant.sealedBag!.declaredCount;

    const result = resolveInspection(bagCards, declaredGood, declaredCount);
    this.revealBagToAll(merchant.sealedBag!);

    let debtPaidGold = 0;
    let debtForgiven = 0;
    let liquidatedLegal = 0;
    let liquidatedContraband = 0;

    if (result.isHonest) {
      // Merchant kept all cards
      for (const card of result.merchantKeptCards) {
        merchant.standLegal.push(cardToState(card));
      }

      // Sheriff pays penalty to merchant via debt resolution
      const debtRes = resolveDebt(
        {
          id: sheriff.id,
          gold: sheriff.gold,
          standLegal: sheriff.standLegal.map(stateToCard),
          standContraband: sheriff.standContraband.map(stateToCard),
        },
        {
          id: merchant.id,
          gold: merchant.gold,
          standLegal: merchant.standLegal.map(stateToCard),
          standContraband: merchant.standContraband.map(stateToCard),
        },
        result.penaltyAmount
      );

      sheriff.gold = debtRes.debtor.gold;
      merchant.gold = debtRes.creditor.gold;
      debtPaidGold = debtRes.paidGold;
      debtForgiven = debtRes.forgivenDebt;
      liquidatedLegal = debtRes.transferredLegalCards.length;
      liquidatedContraband = debtRes.transferredContrabandCards.length;

      for (const card of debtRes.transferredLegalCards) {
        const idx = sheriff.standLegal.findIndex((c) => c.id === card.id);
        if (idx !== -1) sheriff.standLegal.splice(idx, 1);
        merchant.standLegal.push(cardToState(card));
      }
      for (const card of debtRes.transferredContrabandCards) {
        const idx = sheriff.standContraband.findIndex((c) => c.id === card.id);
        if (idx !== -1) {
          sheriff.standContraband.splice(idx, 1);
          sheriff.standContrabandCount = sheriff.standContraband.length;
        }
        const cs = cardToState(card);
        merchant.standContraband.push(cs);
        merchant.standContrabandCount = merchant.standContraband.length;
        const credClient = this.clients.find((c) => c.sessionId === merchant.id);
        if (credClient?.view) credClient.view.add(cs);
      }
    } else {
      // Dishonest: Merchant keeps only truthful legal cards
      for (const card of result.merchantKeptCards) {
        merchant.standLegal.push(cardToState(card));
      }

      // Confiscated cards go to discard pile
      for (const card of result.confiscatedCards) {
        this.internalDiscardPile.push(card);
        this.state.discardPile.push(cardToState(card));
      }

      // Merchant pays fine to Sheriff via debt resolution
      const debtRes = resolveDebt(
        {
          id: merchant.id,
          gold: merchant.gold,
          standLegal: merchant.standLegal.map(stateToCard),
          standContraband: merchant.standContraband.map(stateToCard),
        },
        {
          id: sheriff.id,
          gold: sheriff.gold,
          standLegal: sheriff.standLegal.map(stateToCard),
          standContraband: sheriff.standContraband.map(stateToCard),
        },
        result.penaltyAmount
      );

      merchant.gold = debtRes.debtor.gold;
      sheriff.gold = debtRes.creditor.gold;
      debtPaidGold = debtRes.paidGold;
      debtForgiven = debtRes.forgivenDebt;
      liquidatedLegal = debtRes.transferredLegalCards.length;
      liquidatedContraband = debtRes.transferredContrabandCards.length;

      for (const card of debtRes.transferredLegalCards) {
        const idx = merchant.standLegal.findIndex((c) => c.id === card.id);
        if (idx !== -1) merchant.standLegal.splice(idx, 1);
        sheriff.standLegal.push(cardToState(card));
      }
      for (const card of debtRes.transferredContrabandCards) {
        const idx = merchant.standContraband.findIndex((c) => c.id === card.id);
        if (idx !== -1) {
          merchant.standContraband.splice(idx, 1);
          merchant.standContrabandCount = merchant.standContraband.length;
        }
        const cs = cardToState(card);
        sheriff.standContraband.push(cs);
        sheriff.standContrabandCount = sheriff.standContraband.length;
        const credClient = this.clients.find((c) => c.sessionId === sheriff.id);
        if (credClient?.view) credClient.view.add(cs);
      }
    }

    // Reconcile and apply all accepted negotiation feed bribes targeting this bag (e.g. Rival paid Sheriff to inspect)
    this.reconcileAndExecuteBribesForBag(merchantId, 'INSPECT');

    this.inspectedMerchantIds.add(merchantId);

    if (this.state.activeMerchantId === merchantId) {
      this.state.activeMerchantId = '';
    }
    if (this.state.currentInspectionBagOwnerId === merchantId) {
      this.state.currentInspectionBagOwnerId = '';
    }
    for (let i = this.state.bribeOffers.length - 1; i >= 0; i--) {
      const b = this.state.bribeOffers[i];
      if (b.fromPlayerId === merchantId || b.toPlayerId === merchantId) {
        this.state.bribeOffers.splice(i, 1);
      }
    }
    this.state.activeBribe = undefined;

    this.broadcast('inspection_result', {
      outcome: result.isHonest ? 'HONEST' : 'DISHONEST',
      targetPlayerId: merchantId,
      targetPlayerName: merchant.name,
      sheriffId: sheriff.id,
      sheriffName: sheriff.name,
      declaredGood: declaredGood,
      declaredCount: declaredCount,
      penaltyAmount: result.penaltyAmount,
      keptCardsCount: result.merchantKeptCards.length,
      confiscatedCardsCount: result.confiscatedCards.length,
      debtSettled: true,
      debtPaidGold,
      debtForgiven,
      liquidatedLegalCount: liquidatedLegal,
      liquidatedContrabandCount: liquidatedContraband,
      revealedCards: bagCards,
    });

    this.checkInspectionCompletion();
  }

  private checkInspectionCompletion() {
    const is6pDeputies = this.state.enableDeputies && this.tableSeatIds.length === 6;
    const merchantCount = is6pDeputies ? 4 : this.tableSeatIds.length - 1;
    if (this.inspectedMerchantIds.size >= merchantCount) {
      this.handleRoundEnd();
    }
  }

  private handleRoundEnd() {
    const is6pDeputies = this.state.enableDeputies && this.tableSeatIds.length === 6;

    if (is6pDeputies && this.deputiesEngineState) {
      // Distribute Booty Tile
      if (this.state.bootyTile) {
        const dist = distributeBootyTile({
          gold: this.state.bootyTile.gold,
          goods: this.state.bootyTile.goods.map(stateToCard),
        });

        const dep1 = this.state.players.get(this.state.deputyIds[0]);
        const dep2 = this.state.players.get(this.state.deputyIds[1]);
        if (dep1 && dep2) {
          dep1.gold += dist.deputy1Gold;
          dep2.gold += dist.deputy2Gold;
          for (const g of dist.deputy1Goods) dep1.standLegal.push(cardToState(g));
          for (const g of dist.deputy2Goods) dep2.standLegal.push(cardToState(g));
        }

        for (const g of dist.discardedGoods) {
          this.internalDiscardPile.push(g);
          this.state.discardPile.push(cardToState(g));
        }

        this.state.bootyTile.gold = 0;
        this.state.bootyTile.goods.clear();
      }

      // Check endgame for 6p Deputies: Deputy deck depleted 3 times (9 rounds)
      const isGameOver = this.state.round >= 9 || this.deputiesEngineState.deckDepletions >= 3;

      if (isGameOver) {
        this.finishGame();
        return;
      }

      // Draw next 2 deputies
      const drawResult = drawDeputiesForRound(this.deputiesEngineState);
      this.deputiesEngineState = drawResult.nextState;

      this.state.deputyIds.clear();
      this.state.deputyIds.push(drawResult.deputies[0], drawResult.deputies[1]);
      this.state.sheriffId = drawResult.deputies[0];

      this.tableSeatIds.forEach((id) => {
        const player = this.state.players.get(id)!;
        player.isDeputy = drawResult.deputies.includes(id);
        player.isSheriff = false;
        player.sealedBag = undefined;
      });

      this.state.round++;
    } else {
      const currentSheriff = this.state.players.get(this.state.sheriffId);
      if (currentSheriff) {
        currentSheriff.sheriffCount++;
      }

      const activePlayers = this.tableSeatIds
        .map((id) => this.state.players.get(id))
        .filter((p): p is PlayerState => Boolean(p && p.connected !== false));

      const requiredSheriffTurns =
        this.optionsSheriffRounds ||
        this.state.sheriffRounds ||
        SHERIFF_ROUNDS_BY_PLAYER_COUNT[this.tableSeatIds.length] ||
        2;

      const totalRounds =
        this.state.totalRounds || (requiredSheriffTurns * this.tableSeatIds.length);

      const allMetSheriffTurns =
        activePlayers.length > 0 &&
        activePlayers.every((p) => p.sheriffCount >= requiredSheriffTurns);

      const reachedTotalRounds = this.state.round >= totalRounds;

      const deckDepleted =
        this.internalDrawPile.length === 0 && this.internalDiscardPile.length === 0;

      const isGameOver = allMetSheriffTurns || reachedTotalRounds || deckDepleted;

      if (isGameOver) {
        this.finishGame();
        return;
      }

      // Pass Sheriff standee clockwise
      const currentIdx = this.tableSeatIds.indexOf(this.state.sheriffId);
      const nextSheriffId = this.tableSeatIds[(currentIdx + 1) % this.tableSeatIds.length];

      this.state.sheriffId = nextSheriffId;
      this.state.round++;

      this.tableSeatIds.forEach((id) => {
        const player = this.state.players.get(id)!;
        player.isSheriff = id === nextSheriffId;
        player.sealedBag = undefined;
      });
    }

    // Reset Black Market claims for the new round
    if (this.blackMarketEngineState) {
      this.blackMarketEngineState = resetRoundBlackMarketClaims(this.blackMarketEngineState);
      this.state.players.forEach((p) => {
        p.hasClaimedBlackMarketThisRound = false;
      });
    }

    // Refill all players' hands to 6 cards
    this.tableSeatIds.forEach((id) => {
      const player = this.state.players.get(id)!;
      const needed = Math.max(0, 6 - player.hand.length);
      if (needed > 0) {
        const { drawn, drawPile, discardPile } = drawCards(
          this.internalDrawPile,
          this.internalDiscardPile,
          needed
        );
        this.internalDrawPile = drawPile;
        this.internalDiscardPile = discardPile;
        this.state.drawPileCount = drawPile.length;

        const client = this.clients.find((c) => c.sessionId === id);
        for (const card of drawn) {
          const cs = cardToState(card);
          player.hand.push(cs);
          if (client?.view) {
            client.view.add(cs);
          }
        }
        player.handCount = player.hand.length;
      }
    });

    this.startMarketPhase();
  }

  private finishGame() {
    this.state.phase = 'GAME_OVER';

    // Reveal all contraband and royal identities to all clients with zero-knowledge subscription
    this.state.players.forEach((player) => {
      this.clients.forEach((c) => {
        if (c.view) {
          c.view.subscribe(player.standContraband);
          c.view.subscribe(player.standRoyal);
          c.view.add(player.standContraband);
          c.view.add(player.standRoyal);
          for (const card of player.standContraband) c.view.add(card);
          for (const card of player.standRoyal) c.view.add(card);
        }
      });
    });

    // Score game
    const scoringInputs: PlayerStandInput[] = this.tableSeatIds.map((id) => {
      const p = this.state.players.get(id)!;
      return {
        id: p.id,
        name: p.name,
        gold: p.gold,
        standLegal: p.standLegal.map(stateToCard),
        standContraband: p.standContraband.map(stateToCard),
        standRoyal: p.standRoyal.map(stateToCard),
      };
    });

    const breakdowns = calculateScores(scoringInputs);

    this.state.leaderboard.clear();
    for (const b of breakdowns) {
      this.state.leaderboard.push(
        new PlayerScoreState({
          playerId: b.playerId,
          name: b.name,
          gold: b.gold,
          goodsValue: b.goodsValue,
          bonusPoints: b.bonusPoints,
          totalScore: b.totalScore,
          legalGoodsCount: b.legalGoodsCount,
          contrabandCount: b.contrabandCount,
          rank: b.rank,
        })
      );
    }

    if (breakdowns.length > 0) {
      this.state.winnerId = breakdowns[0].playerId;
      this.state.winningScore = breakdowns[0].totalScore;
    }

    this.broadcast('game_over', {
      winnerId: this.state.winnerId,
      winningScore: this.state.winningScore,
      leaderboard: breakdowns,
    });
  }
}
