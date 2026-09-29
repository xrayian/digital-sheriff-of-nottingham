import { create } from 'zustand';
import type {
  GamePhase,
  InspectionResultMessage,
  NegotiationOfferStatus,
  NegotiationIntendedOutcome,
  ForcedCommitmentOutcome,
  BribeReconciliationRecord,
  ClientPlayerScore,
} from '@sheriff/shared';
import { soundManager } from '../audio/soundManager';

export interface ClientNegotiationOffer {
  id: string;
  fromPlayerId: string;
  targetBagOwnerId: string;
  intendedOutcome: NegotiationIntendedOutcome;
  goldOffered: number;
  standLegalGoodsOffered: string[];
  standContrabandCountOffered: number;
  bagGoodsCountOffered: number;
  futureFavorText?: string;
  status: NegotiationOfferStatus;
  acceptedByPlayerId?: string;
  sequence: number;
  timestamp: number;
}

export interface ClientPendingCommitment {
  sourceOfferId: string;
  targetBagOwnerId: string;
  forcedOutcome: ForcedCommitmentOutcome;
}

export interface CrossBagToast {
  fromPlayerId: string;
  fromPlayerName: string;
  targetBagOwnerId: string;
  targetPlayerName: string;
  goldOffered: number;
  intendedOutcome: string;
  timestamp: number;
}

export interface DealStruckBanner {
  offerId: string;
  fromPlayerId: string;
  targetBagOwnerId: string;
  forcedOutcome: string;
  acceptedByPlayerId: string;
  timestamp: number;
}

export interface ClientDiscardLogEntry {
  id: string;
  round: number;
  playerId: string;
  playerName: string;
  cardNames: string[];
  cardCount: number;
  timestamp: number;
}

export interface ClientCard {
  id: string;
  name: string;
  classification: 'LEGAL' | 'CONTRABAND' | 'ROYAL';
  goodType?: string;
  contrabandType?: string;
  royalGoodType?: string;
  baseGood?: string;
  royalBonusCount?: number;
  value: number;
  penalty: number;
}

export interface ClientSealedBag {
  playerId: string;
  cardCount: number;
  declaredGood: string;
  declaredCount: number;
  isSnapped: boolean;
  isRevealed: boolean;
  cards: ClientCard[];
}

export interface ClientPlayer {
  id: string;
  sessionId: string;
  name: string;
  gold: number;
  ready: boolean;
  connected: boolean;
  seatIndex: number;
  isSheriff: boolean;
  isDeputy: boolean;
  handCount: number;
  hand: ClientCard[];
  standLegal: ClientCard[];
  standContrabandCount: number;
  standContraband: ClientCard[];
  standRoyalCount: number;
  standRoyal: ClientCard[];
  hasClaimedBlackMarketThisRound: boolean;
  sealedBag?: ClientSealedBag;
  sheriffCount: number;
}

export interface ClientBribeOffer {
  id: string;
  sequenceNumber: number;
  fromPlayerId: string;
  toPlayerId: string;
  gold: number;
  standCardIds: string[];
  bagCardClaims: string[];
  nonBindingTerms: string;
  status: string;
}

export interface ClientBlackMarketOrder {
  id: string;
  name: string;
  contrabandType: string;
  requiredCount: number;
  pointsValue: number;
}

export interface ClientBootyTile {
  gold: number;
  goodsCount: number;
}

interface GameStore {
  phase: GamePhase | null;
  roomId: string | null;
  localPlayerId: string | null;
  players: Map<string, ClientPlayer>;
  round: number;
  sheriffId: string | null;
  deputyIds: string[];
  activeMerchantId: string | null;
  drawPileCount: number;
  discardPile: ClientCard[];
  connected: boolean;
  activeBribe?: ClientBribeOffer;
  bribeOffers: ClientBribeOffer[];
  winnerId: string | null;
  winningScore: number;
  totalRounds: number;
  sheriffRounds: number;
  leaderboard: ClientPlayerScore[];

  // Module Expansion State
  enableRoyalGoods: boolean;
  enableDeputies: boolean;
  enableBlackMarket: boolean;
  maxPlayers: number;
  bootyTile?: ClientBootyTile;
  blackMarketPepperPile: ClientBlackMarketOrder[];
  blackMarketMeadPile: ClientBlackMarketOrder[];
  blackMarketSilkPile: ClientBlackMarketOrder[];

  // Phase 4 & 5 Negotiation Feed Rework
  negotiationFeed: ClientNegotiationOffer[];
  pendingCommitments: ClientPendingCommitment[];
  currentInspectionBagOwnerId: string;
  negotiationSequence: number;
  reconciliationRecords: BribeReconciliationRecord[];
  addReconciliationRecord: (record: BribeReconciliationRecord) => void;
  crossBagToast: CrossBagToast | null;
  setCrossBagToast: (toast: CrossBagToast | null) => void;
  dealStruckBanner: DealStruckBanner | null;
  setDealStruckBanner: (banner: DealStruckBanner | null) => void;
  offerModalTargetBagOwnerId: string | null;
  openOfferModal: (targetBagOwnerId: string) => void;
  closeOfferModal: () => void;
  isDeskMinimized: boolean;
  setIsDeskMinimized: (minimized: boolean) => void;

  // Phase 4 UI state
  selectedCardIds: string[];
  errorMessage: string | null;
  errorTimestamp: number;

  // Phase 5 Inspection & Bribe state
  lastInspectionResult: InspectionResultMessage | null;
  bribeReactionCooldown: boolean;

  // Phase 7 Settings & Accessibility
  reducedMotion: boolean;
  soundEnabled: boolean;
  ambientEnabled: boolean;

  // Immersive Fullscreen & Rulebook
  isFullscreen: boolean;
  setIsFullscreen: (fullscreen: boolean) => void;
  toggleFullscreen: () => void;
  isRulebookOpen: boolean;
  rulebookActiveChapter: number;
  openRulebook: (chapterIndex?: number) => void;
  closeRulebook: () => void;

  // Discard Pile & Discard Log
  discardLog: ClientDiscardLogEntry[];
  isDiscardPileOpen: boolean;
  openDiscardPile: () => void;
  closeDiscardPile: () => void;

  setPhase: (phase: GamePhase) => void;
  setRoomId: (id: string) => void;
  setLocalPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  updateGameState: (state: any) => void;
  updatePlayers: (players: Map<string, ClientPlayer>) => void;
  toggleCardSelection: (cardId: string) => void;
  addCardToSelection: (cardId: string) => void;
  removeCardFromSelection: (cardId: string) => void;
  clearSelection: () => void;
  setError: (message: string) => void;
  clearError: () => void;
  setLastInspectionResult: (result: InspectionResultMessage | null) => void;
  setBribeReactionCooldown: (cooldown: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setAmbientEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState = {
  phase: null as GamePhase | null,
  roomId: null as string | null,
  localPlayerId: null as string | null,
  players: new Map<string, ClientPlayer>(),
  round: 0,
  sheriffId: null as string | null,
  deputyIds: [] as string[],
  activeMerchantId: null as string | null,
  drawPileCount: 0,
  discardPile: [] as ClientCard[],
  discardLog: [] as ClientDiscardLogEntry[],
  isDiscardPileOpen: false,
  connected: false,
  activeBribe: undefined as ClientBribeOffer | undefined,
  bribeOffers: [] as ClientBribeOffer[],
  negotiationFeed: [] as ClientNegotiationOffer[],
  pendingCommitments: [] as ClientPendingCommitment[],
  currentInspectionBagOwnerId: '',
  negotiationSequence: 1,
  reconciliationRecords: [] as BribeReconciliationRecord[],
  crossBagToast: null as CrossBagToast | null,
  dealStruckBanner: null as DealStruckBanner | null,
  offerModalTargetBagOwnerId: null as string | null,
  isDeskMinimized: false,
  winnerId: null as string | null,
  winningScore: 0,
  totalRounds: 0,
  sheriffRounds: 0,
  leaderboard: [] as ClientPlayerScore[],
  enableRoyalGoods: false,
  enableDeputies: false,
  enableBlackMarket: false,
  maxPlayers: 4,
  bootyTile: undefined as ClientBootyTile | undefined,
  blackMarketPepperPile: [] as ClientBlackMarketOrder[],
  blackMarketMeadPile: [] as ClientBlackMarketOrder[],
  blackMarketSilkPile: [] as ClientBlackMarketOrder[],
  selectedCardIds: [] as string[],
  errorMessage: null as string | null,
  errorTimestamp: 0,
  lastInspectionResult: null as InspectionResultMessage | null,
  bribeReactionCooldown: false,
  reducedMotion: false,
  soundEnabled: true,
  ambientEnabled: true,
  isFullscreen: false,
  isRulebookOpen: false,
  rulebookActiveChapter: 0,
};

export function toggleBrowserFullscreen() {
  if (typeof document === 'undefined') return;
  const isFull = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
  if (!isFull) {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(() => {});
    } else if ((elem as any).webkitRequestFullscreen) {
      (elem as any).webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    }
  }
}

function mapCard(c: any): ClientCard {
  return {
    id: c.id,
    name: c.name,
    classification: c.classification,
    goodType: c.goodType || undefined,
    contrabandType: c.contrabandType || undefined,
    royalGoodType: c.royalGoodType || undefined,
    baseGood: c.baseGood || undefined,
    royalBonusCount: c.royalBonusCount || 0,
    value: c.value,
    penalty: c.penalty,
  };
}

export const useGameStore = create<GameStore>((set) => ({
  ...initialState,
  setPhase: (phase) => set({ phase }),
  setRoomId: (id) => set({ roomId: id }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setConnected: (connected) => set({ connected }),
  updatePlayers: (players) => set({ players }),
  updateGameState: (state: any) => {
    if (!state) return;
    const players = new Map<string, ClientPlayer>();

    if (state.players && typeof state.players.forEach === 'function') {
      state.players.forEach((p: any, key: string) => {
        const hand: ClientCard[] = p.hand ? Array.from(p.hand).map(mapCard) : [];
        const standLegal: ClientCard[] = p.standLegal ? Array.from(p.standLegal).map(mapCard) : [];
        const standContraband: ClientCard[] = p.standContraband ? Array.from(p.standContraband).map(mapCard) : [];
        const standRoyal: ClientCard[] = p.standRoyal ? Array.from(p.standRoyal).map(mapCard) : [];

        let sealedBag: ClientSealedBag | undefined = undefined;
        if (p.sealedBag) {
          sealedBag = {
            playerId: p.sealedBag.playerId,
            cardCount: p.sealedBag.cardCount,
            declaredGood: p.sealedBag.declaredGood,
            declaredCount: p.sealedBag.declaredCount,
            isSnapped: p.sealedBag.isSnapped,
            isRevealed: p.sealedBag.isRevealed,
            cards: p.sealedBag.cards ? Array.from(p.sealedBag.cards).map(mapCard) : [],
          };
        }

        players.set(key, {
          id: p.id,
          sessionId: p.sessionId || key,
          name: p.name,
          gold: p.gold,
          ready: p.ready,
          connected: p.connected,
          seatIndex: p.seatIndex,
          isSheriff: p.isSheriff,
          isDeputy: p.isDeputy,
          handCount: p.handCount || hand.length,
          hand,
          standLegal,
          standContrabandCount: p.standContrabandCount || 0,
          standContraband,
          standRoyalCount: p.standRoyalCount || standRoyal.length,
          standRoyal,
          hasClaimedBlackMarketThisRound: Boolean(p.hasClaimedBlackMarketThisRound),
          sealedBag,
          sheriffCount: p.sheriffCount || 0,
        });
      });
    }

    const discardPile: ClientCard[] = state.discardPile
      ? Array.from(state.discardPile).map(mapCard)
      : [];

    const discardLog: ClientDiscardLogEntry[] = state.discardLog
      ? Array.from(state.discardLog).map((entry: any) => ({
          id: entry.id,
          round: entry.round ?? 1,
          playerId: entry.playerId || '',
          playerName: entry.playerName || 'Merchant',
          cardNames: entry.cardNames ? Array.from(entry.cardNames) : [],
          cardCount: entry.cardCount ?? (entry.cardNames ? entry.cardNames.length : 0),
          timestamp: entry.timestamp || 0,
        }))
      : [];

    const mapBribe = (b: any): ClientBribeOffer => ({
      id: b.id,
      sequenceNumber: b.sequenceNumber || 1,
      fromPlayerId: b.fromPlayerId,
      toPlayerId: b.toPlayerId,
      gold: b.gold || 0,
      standCardIds: b.standCardIds ? Array.from(b.standCardIds) : [],
      bagCardClaims: b.bagCardClaims ? Array.from(b.bagCardClaims) : [],
      nonBindingTerms: b.nonBindingTerms || '',
      status: b.status || 'PROPOSED',
    });

    let activeBribe: ClientBribeOffer | undefined = undefined;
    if (state.activeBribe) {
      activeBribe = mapBribe(state.activeBribe);
    }

    const bribeOffers: ClientBribeOffer[] = state.bribeOffers
      ? Array.from(state.bribeOffers).map(mapBribe)
      : [];

    let bootyTile: ClientBootyTile | undefined = undefined;
    if (state.bootyTile) {
      bootyTile = {
        gold: state.bootyTile.gold || 0,
        goodsCount: state.bootyTile.goods ? state.bootyTile.goods.length : 0,
      };
    }

    const mapBMOrder = (o: any): ClientBlackMarketOrder => ({
      id: o.id,
      name: o.name,
      contrabandType: o.contrabandType,
      requiredCount: o.requiredCount || 3,
      pointsValue: o.pointsValue || 0,
    });

    const blackMarketPepperPile: ClientBlackMarketOrder[] = state.blackMarketPepperPile
      ? Array.from(state.blackMarketPepperPile).map(mapBMOrder)
      : [];
    const blackMarketMeadPile: ClientBlackMarketOrder[] = state.blackMarketMeadPile
      ? Array.from(state.blackMarketMeadPile).map(mapBMOrder)
      : [];
    const blackMarketSilkPile: ClientBlackMarketOrder[] = state.blackMarketSilkPile
      ? Array.from(state.blackMarketSilkPile).map(mapBMOrder)
      : [];

    const mapNegotiationOffer = (o: any): ClientNegotiationOffer => ({
      id: o.id,
      fromPlayerId: o.fromPlayerId,
      targetBagOwnerId: o.targetBagOwnerId,
      intendedOutcome: o.intendedOutcome || 'PASS',
      goldOffered: o.goldOffered || 0,
      standLegalGoodsOffered: o.standLegalGoodsOffered ? Array.from(o.standLegalGoodsOffered) : [],
      standContrabandCountOffered: o.standContrabandCountOffered || 0,
      bagGoodsCountOffered: o.bagGoodsCountOffered || 0,
      futureFavorText: o.futureFavorText || '',
      status: o.status || 'OPEN',
      acceptedByPlayerId: o.acceptedByPlayerId || '',
      sequence: o.sequence || 1,
      timestamp: o.timestamp || Date.now(),
    });

    const negotiationFeed: ClientNegotiationOffer[] = state.negotiationFeed
      ? Array.from(state.negotiationFeed).map(mapNegotiationOffer)
      : [];

    const mapCommitment = (c: any): ClientPendingCommitment => ({
      sourceOfferId: c.sourceOfferId,
      targetBagOwnerId: c.targetBagOwnerId,
      forcedOutcome: c.forcedOutcome,
    });

    const pendingCommitments: ClientPendingCommitment[] = state.pendingCommitments
      ? Array.from(state.pendingCommitments).map(mapCommitment)
      : [];

    const leaderboard: ClientPlayerScore[] = state.leaderboard
      ? Array.from(state.leaderboard).map((entry: any) => ({
          playerId: entry.playerId,
          name: entry.name,
          gold: entry.gold ?? 0,
          goodsValue: entry.goodsValue ?? 0,
          bonusPoints: entry.bonusPoints ?? 0,
          totalScore: entry.totalScore ?? 0,
          legalGoodsCount: entry.legalGoodsCount ?? 0,
          contrabandCount: entry.contrabandCount ?? 0,
          rank: entry.rank ?? 1,
        }))
      : [];

    const prev = useGameStore.getState();
    const phaseChanged = prev.phase !== state.phase;
    const merchantChanged = prev.activeMerchantId !== state.activeMerchantId;
    const bribeUpdated = Boolean(
      activeBribe &&
      prev.activeBribe &&
      activeBribe.sequenceNumber !== prev.activeBribe.sequenceNumber
    );

    set({
      phase: state.phase as GamePhase,
      round: state.round || 0,
      totalRounds: state.totalRounds || 0,
      sheriffRounds: state.sheriffRounds || 0,
      sheriffId: state.sheriffId || null,
      deputyIds: state.deputyIds ? Array.from(state.deputyIds) : [],
      activeMerchantId: state.activeMerchantId || null,
      drawPileCount: state.drawPileCount || 0,
      discardPile,
      discardLog,
      players,
      activeBribe,
      bribeOffers,
      negotiationFeed,
      pendingCommitments,
      currentInspectionBagOwnerId: state.currentInspectionBagOwnerId || '',
      negotiationSequence: state.negotiationSequence || 1,
      winnerId: state.winnerId || null,
      winningScore: state.winningScore || 0,
      leaderboard,
      enableRoyalGoods: Boolean(state.enableRoyalGoods),
      enableDeputies: Boolean(state.enableDeputies),
      enableBlackMarket: Boolean(state.enableBlackMarket),
      maxPlayers: state.maxPlayers || 4,
      bootyTile,
      blackMarketPepperPile,
      blackMarketMeadPile,
      blackMarketSilkPile,
      selectedCardIds: (phaseChanged || merchantChanged) ? [] : prev.selectedCardIds,
      reconciliationRecords: phaseChanged && state.phase === 'INSPECTION' ? [] : prev.reconciliationRecords,
    });

    // Trigger 1.5s reaction buffer lock if active bribe offer terms updated (docs/architecture.md §6.2)
    if (bribeUpdated) {
      set({ bribeReactionCooldown: true });
      setTimeout(() => {
        set({ bribeReactionCooldown: false });
      }, 1500);
    }
  },
  addReconciliationRecord: (record) =>
    set((s) => ({ reconciliationRecords: [...s.reconciliationRecords, record] })),
  setCrossBagToast: (crossBagToast) => set({ crossBagToast }),
  setDealStruckBanner: (dealStruckBanner) => set({ dealStruckBanner }),
  openOfferModal: (targetBagOwnerId) => set({ offerModalTargetBagOwnerId: targetBagOwnerId }),
  closeOfferModal: () => set({ offerModalTargetBagOwnerId: null }),
  setIsDeskMinimized: (isDeskMinimized) => set({ isDeskMinimized }),
  toggleCardSelection: (cardId) =>
    set((s) => {
      const idx = s.selectedCardIds.indexOf(cardId);
      if (idx >= 0) {
        return { selectedCardIds: s.selectedCardIds.filter((id) => id !== cardId) };
      }
      return { selectedCardIds: [...s.selectedCardIds, cardId] };
    }),
  addCardToSelection: (cardId) =>
    set((s) => {
      if (s.selectedCardIds.includes(cardId) || s.selectedCardIds.length >= 5) return s;
      return { selectedCardIds: [...s.selectedCardIds, cardId] };
    }),
  removeCardFromSelection: (cardId) =>
    set((s) => ({
      selectedCardIds: s.selectedCardIds.filter((id) => id !== cardId),
    })),
  clearSelection: () => set({ selectedCardIds: [] }),
  setError: (message) => set({ errorMessage: message, errorTimestamp: Date.now() }),
  clearError: () => set({ errorMessage: null }),
  setLastInspectionResult: (result) => set({ lastInspectionResult: result }),
  setBribeReactionCooldown: (cooldown) => set({ bribeReactionCooldown: cooldown }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setSoundEnabled: (soundEnabled) => {
    soundManager.setEnabled(soundEnabled);
    set({ soundEnabled });
  },
  setAmbientEnabled: (ambientEnabled) => {
    soundManager.setAmbientEnabled(ambientEnabled);
    set({ ambientEnabled });
  },
  setIsFullscreen: (isFullscreen) => set({ isFullscreen }),
  toggleFullscreen: () => {
    toggleBrowserFullscreen();
  },
  openRulebook: (chapterIndex = 0) => set({ isRulebookOpen: true, rulebookActiveChapter: chapterIndex }),
  closeRulebook: () => set({ isRulebookOpen: false }),
  openDiscardPile: () => set({ isDiscardPileOpen: true }),
  closeDiscardPile: () => set({ isDiscardPileOpen: false }),
  reset: () => set(initialState),
}));
