export type GoodType = 'APPLE' | 'CHEESE' | 'BREAD' | 'CHICKEN';
export type ContrabandType = 'PEPPER' | 'MEAD' | 'SILK' | 'CROSSBOW';
export type RoyalGoodType = 'GREEN_APPLE' | 'GOLDEN_APPLE' | 'GOUDA_CHEESE' | 'BLUE_CHEESE' | 'RYE_BREAD' | 'PUMPERNICKEL_BREAD' | 'ROYAL_ROOSTER';
export type CardClassification = 'LEGAL' | 'CONTRABAND' | 'ROYAL';
export type GamePhase = 'LOBBY' | 'MARKET' | 'LOAD_BAG' | 'DECLARATION' | 'INSPECTION' | 'ROUND_END' | 'GAME_OVER';
export type BribeStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';

export interface CardDefinition {
  name: string;
  classification: CardClassification;
  goodType?: GoodType;
  contrabandType?: ContrabandType;
  royalGoodType?: RoyalGoodType;
  baseGood?: GoodType;
  royalBonusCount?: number;
  value: number;
  penalty: number;
  count3Player: number;
  count4PlusPlayer: number;
  fourPlusOnly: boolean;
}

export interface Card {
  id: string;
  name: string;
  classification: CardClassification;
  goodType?: GoodType;
  contrabandType?: ContrabandType;
  royalGoodType?: RoyalGoodType;
  baseGood?: GoodType;
  royalBonusCount?: number;
  value: number;
  penalty: number;
}

export interface PlayerStand {
  legalGoods: Card[];
  contraband: Card[];
  royalGoods: Card[];
}

export interface SealedBag {
  playerId: string;
  cards: Card[];
  isSnapped: boolean;
  declaredGood?: GoodType;
  declaredCount?: number;
}

export interface EnginePlayerState {
  id: string;
  name: string;
  gold: number;
  hand: Card[];
  stand: PlayerStand;
  sealedBag?: SealedBag;
}

export interface InspectionResult {
  isHonest: boolean;
  declaredGood: GoodType;
  declaredCount: number;
  keptCards: Card[];
  confiscatedCards: Card[];
  penaltyAmount: number;
  penaltyDebtor: 'SHERIFF' | 'MERCHANT' | 'NONE';
  penaltyCreditor: 'SHERIFF' | 'MERCHANT' | 'NONE';
}

export interface DebtResolutionResult {
  paidGold: number;
  transferredLegalCards: Card[];
  transferredContrabandCards: Card[];
  forgivenDebt: number;
  remainingDebt: number;
  settled: boolean;
}

export interface BonusAward {
  goodType: GoodType;
  title: 'KING' | 'QUEEN' | 'TIED_KING' | 'TIED_QUEEN';
  points: number;
}

export interface PlayerScoreBreakdown {
  playerId: string;
  name: string;
  gold: number;
  goodsValue: number;
  legalGoodsValue: number;
  contrabandValue: number;
  royalGoodsValue: number;
  bonusPoints: number;
  bonuses: BonusAward[];
  totalScore: number;
  legalGoodsCount: number;
  contrabandCount: number;
  rank: number;
}

export interface BlackMarketOrder {
  id: string;
  name: string;
  contrabandType: ContrabandType;
  requiredCount: number;
  pointsValue: number;
}

export interface BootyTileData {
  gold: number;
  goods: Card[];
}

export type NegotiationOfferStatus = 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'VOIDED';
export type NegotiationIntendedOutcome = 'PASS' | 'INSPECT' | 'FORCE_INSPECT' | 'FORCE_PASS';
export type ForcedCommitmentOutcome = 'FORCE_INSPECT' | 'FORCE_PASS';

export interface NegotiationOffer {
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

export interface PendingCommitment {
  sourceOfferId: string;
  targetBagOwnerId: string;
  forcedOutcome: ForcedCommitmentOutcome;
}

export interface BribeReconciliationRecord {
  offerId: string;
  fromPlayerId: string;
  targetBagOwnerId: string;
  honoredGold: number;
  honoredLegalCardsCount: number;
  honoredContrabandCount: number;
  honoredBagCardsCount: number;
  voidedContrabandCount: number;
  voidedBagCardsCount: number;
  summaryText: string;
}
export interface ClientPlayerScore {
  playerId: string;
  name: string;
  gold: number;
  goodsValue: number;
  bonusPoints: number;
  totalScore: number;
  legalGoodsCount: number;
  contrabandCount: number;
  rank: number;
}
