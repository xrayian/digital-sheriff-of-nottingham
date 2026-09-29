import { describe, it, expect } from 'vitest';
import { Card, SealedBag } from '@sheriff/shared';
import { validateBagCards, loadAndSnapBag } from '../../src/engine/phases/loadBag';
import { validateDeclaration, applyDeclaration } from '../../src/engine/phases/declaration';
import { resolveInspection, resolvePassUnopened } from '../../src/engine/phases/inspection';
import { calculateKingQueenBonuses, calculateScores, PlayerStandInput } from '../../src/engine/scoring';
import { resolveDebt } from '../../src/engine/debtResolution';

describe('Sheriff of Nottingham 2nd Edition — Official Rulebook Compliance Tests', () => {
  // Helper factories
  const makeLegal = (id: string, goodType: 'APPLE' | 'CHEESE' | 'BREAD' | 'CHICKEN'): Card => ({
    id,
    name: goodType,
    classification: 'LEGAL',
    goodType,
    value: goodType === 'CHICKEN' ? 4 : goodType === 'APPLE' ? 2 : 3,
    penalty: 2,
  });

  const makeContraband = (
    id: string,
    contrabandType: 'PEPPER' | 'MEAD' | 'SILK' | 'CROSSBOW',
    value = 6,
    penalty = 4
  ): Card => ({
    id,
    name: contrabandType,
    classification: 'CONTRABAND',
    contrabandType,
    value,
    penalty,
  });

  const makeRoyal = (
    id: string,
    name: string,
    baseGood: 'APPLE' | 'CHEESE' | 'BREAD' | 'CHICKEN',
    bonusCount: number,
    value: number,
    penalty = 4
  ): Card => ({
    id,
    name,
    classification: 'ROYAL',
    baseGood,
    royalBonusCount: bonusCount,
    value,
    penalty,
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 2: Loading Bag Compliance                                            */
  /* -------------------------------------------------------------------------- */
  describe('Rulebook: Phase 2 - Loading Bag (1 to 5 goods, any mixture permitted)', () => {
    it('permits loading any combination of legal, contraband, and royal goods up to 5', () => {
      const hand: Card[] = [
        makeLegal('l1', 'APPLE'),
        makeLegal('l2', 'CHEESE'),
        makeContraband('c1', 'PEPPER'),
        makeContraband('c2', 'SILK'),
        makeRoyal('r1', 'Golden Apples', 'APPLE', 2, 6),
        makeLegal('l3', 'BREAD'),
      ];

      // Pack 5 cards with mixed classifications
      const selected = ['l1', 'l2', 'c1', 'c2', 'r1'];
      const validation = validateBagCards(selected, hand);
      expect(validation.valid).toBe(true);

      const result = loadAndSnapBag({
        playerId: 'merchant_1',
        hand,
        cardIdsToLoad: selected,
      });

      expect(result.sealedBag.cards).toHaveLength(5);
      expect(result.sealedBag.isSnapped).toBe(true);
      expect(result.remainingHand).toHaveLength(1);
      expect(result.remainingHand[0].id).toBe('l3');
    });

    it('strictly enforces limits: rejects 0 cards and rejects >5 cards', () => {
      const hand = Array.from({ length: 6 }, (_, i) => makeLegal(`card_${i}`, 'APPLE'));

      expect(validateBagCards([], hand).valid).toBe(false);
      expect(validateBagCards(hand.map((c) => c.id), hand).valid).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 3: Declaration Compliance                                            */
  /* -------------------------------------------------------------------------- */
  describe('Rulebook: Phase 3 - Declaration (Must declare 1 legal good & exact count)', () => {
    it('accepts exact count and legal good declaration', () => {
      const bagCards = [
        makeLegal('a1', 'APPLE'),
        makeContraband('p1', 'PEPPER'),
        makeContraband('s1', 'SILK'),
      ];

      // Merchant bluffs: 3 cards loaded, declares "3 Apples"
      const validation = validateDeclaration(bagCards, 3, 'APPLE');
      expect(validation.valid).toBe(true);

      const sealedBag: SealedBag = {
        playerId: 'bluffer',
        cards: bagCards,
        isSnapped: true,
      };

      const declared = applyDeclaration(sealedBag, 3, 'APPLE');
      expect(declared.declaredCount).toBe(3);
      expect(declared.declaredGood).toBe('APPLE');
    });

    it('forbids declaring contraband or royal goods even if present in the bag', () => {
      const bagCards = [makeContraband('p1', 'PEPPER')];

      // You can never declare Contraband under official rules
      expect(validateDeclaration(bagCards, 1, 'PEPPER').valid).toBe(false);
      expect(validateDeclaration(bagCards, 1, 'SILK').valid).toBe(false);
      expect(validateDeclaration(bagCards, 1, 'GOLDEN_APPLE').valid).toBe(false);
    });

    it('strictly enforces that declared count must equal the number of cards in bag', () => {
      const bagCards = [makeLegal('a1', 'APPLE'), makeLegal('a2', 'APPLE')];

      // Bag has 2 cards, declaring 3 is illegal
      const valOver = validateDeclaration(bagCards, 3, 'APPLE');
      expect(valOver.valid).toBe(false);
      expect(valOver.error).toMatch(/does not match exact bag card count/);

      // Bag has 2 cards, declaring 1 is illegal
      const valUnder = validateDeclaration(bagCards, 1, 'APPLE');
      expect(valUnder.valid).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 4: Inspection Resolution & Penalty Penalties                         */
  /* -------------------------------------------------------------------------- */
  describe('Rulebook: Phase 4 - Inspection & Statutory Penalties', () => {
    it('Truthful Merchant: Sheriff pays full penalty on all goods in bag', () => {
      // 5 Apples declared and loaded
      const bag = [
        makeLegal('a1', 'APPLE'),
        makeLegal('a2', 'APPLE'),
        makeLegal('a3', 'APPLE'),
        makeLegal('a4', 'APPLE'),
        makeLegal('a5', 'APPLE'),
      ];

      const result = resolveInspection(bag, 'APPLE', 5);

      expect(result.isHonest).toBe(true);
      expect(result.merchantKeptCards).toHaveLength(5);
      expect(result.confiscatedCards).toHaveLength(0);
      expect(result.penaltyAmount).toBe(10); // 5 * 2 gold
      expect(result.debtor).toBe('SHERIFF');
      expect(result.creditor).toBe('MERCHANT');
    });

    it('Complete Bluff (All Contraband): Sheriff confiscates all and merchant pays fine for each', () => {
      // Declared 4 Cheese; Bag contains 2 Pepper (val 6, pen 4), 1 Silk (val 8, pen 4), 1 Crossbow (val 9, pen 4)
      const bag = [
        makeContraband('p1', 'PEPPER', 6, 4),
        makeContraband('p2', 'PEPPER', 6, 4),
        makeContraband('s1', 'SILK', 8, 4),
        makeContraband('cb1', 'CROSSBOW', 9, 4),
      ];

      const result = resolveInspection(bag, 'CHEESE', 4);

      expect(result.isHonest).toBe(false);
      expect(result.merchantKeptCards).toHaveLength(0);
      expect(result.confiscatedCards).toHaveLength(4);
      expect(result.penaltyAmount).toBe(16); // 4 cards * 4 penalty = 16 gold
      expect(result.debtor).toBe('MERCHANT');
      expect(result.creditor).toBe('SHERIFF');
    });

    it('Partial Honesty (Mixed Legal Goods): Merchant keeps declared goods, undeclared goods confiscated', () => {
      // Declared 4 Bread; Bag has 2 Bread (pen 2), 2 Cheese (pen 2)
      const bag = [
        makeLegal('b1', 'BREAD'),
        makeLegal('b2', 'BREAD'),
        makeLegal('ch1', 'CHEESE'),
        makeLegal('ch2', 'CHEESE'),
      ];

      const result = resolveInspection(bag, 'BREAD', 4);

      expect(result.isHonest).toBe(false);
      // Keeps the 2 truthfully declared Bread
      expect(result.merchantKeptCards.map((c) => c.id)).toEqual(['b1', 'b2']);
      // Confiscates the 2 Cheese
      expect(result.confiscatedCards.map((c) => c.id)).toEqual(['ch1', 'ch2']);
      // Merchant pays fine ONLY on confiscated cards: 2 * 2 = 4 gold
      expect(result.penaltyAmount).toBe(4);
      expect(result.debtor).toBe('MERCHANT');
    });

    it('Royal Goods treated as Contraband during Inspection: Confiscated with penalty', () => {
      // Declared 3 Apples; Bag has 2 Apples (pen 2) + 1 Golden Apple (Royal Good, pen 4)
      const bag = [
        makeLegal('a1', 'APPLE'),
        makeLegal('a2', 'APPLE'),
        makeRoyal('rg1', 'Golden Apples', 'APPLE', 2, 6, 4),
      ];

      const result = resolveInspection(bag, 'APPLE', 3);

      expect(result.isHonest).toBe(false);
      // Keeps the 2 legal Apples
      expect(result.merchantKeptCards.map((c) => c.id)).toEqual(['a1', 'a2']);
      // Golden Apple is confiscated as contraband
      expect(result.confiscatedCards.map((c) => c.id)).toEqual(['rg1']);
      // Merchant pays fine for Golden Apple: 4 gold
      expect(result.penaltyAmount).toBe(4);
      expect(result.debtor).toBe('MERCHANT');
    });

    it('Safe Passage (Pass Unopened): All cards pass to merchant stand, no penalties, bribe executes', () => {
      const bag = [
        makeLegal('a1', 'APPLE'),
        makeContraband('p1', 'PEPPER'),
        makeRoyal('rg1', 'Golden Apples', 'APPLE', 2, 6),
      ];

      const standCards = [makeLegal('st1', 'BREAD')];

      // Merchant offered 5 gold + stand card 'st1' + promised 1 Pepper from bag
      const result = resolvePassUnopened(
        bag,
        {
          gold: 5,
          standCardIds: ['st1'],
          bagGoodsClaims: [{ goodType: 'PEPPER', count: 1 }],
        },
        standCards
      );

      // Merchant keeps the legal apple and royal good
      expect(result.merchantKeptLegalCards.map((c) => c.id)).toEqual(['a1']);
      expect(result.merchantKeptContrabandCards.map((c) => c.id)).toEqual(['rg1']);
      // Pepper was surrendered to Sheriff per bribe terms
      expect(result.sheriffReceivedBagCards.map((c) => c.id)).toEqual(['p1']);
      // Gold and stand card transferred
      expect(result.merchantPaidGold).toBe(5);
      expect(result.merchantTransferredStandCards.map((c) => c.id)).toEqual(['st1']);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 5: Endgame Scoring & King/Queen Tiebreakers                          */
  /* -------------------------------------------------------------------------- */
  describe('Rulebook: Phase 5 - Scoring, King/Queen Bonuses & Multi-Way Ties', () => {
    it('4-way King Tie: King and Queen bonuses combined and divided equally, Queen skipped', () => {
      // 4 players tie for Bread King (Bread King = 15, Queen = 10; Total = 25; 25 / 4 = 6 each floored)
      const p1: PlayerStandInput = { id: 'p1', name: 'P1', gold: 0, standLegal: [makeLegal('b1', 'BREAD')], standContraband: [] };
      const p2: PlayerStandInput = { id: 'p2', name: 'P2', gold: 0, standLegal: [makeLegal('b2', 'BREAD')], standContraband: [] };
      const p3: PlayerStandInput = { id: 'p3', name: 'P3', gold: 0, standLegal: [makeLegal('b3', 'BREAD')], standContraband: [] };
      const p4: PlayerStandInput = { id: 'p4', name: 'P4', gold: 0, standLegal: [makeLegal('b4', 'BREAD')], standContraband: [] };

      const bonuses = calculateKingQueenBonuses([p1, p2, p3, p4]);

      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        const playerBonuses = bonuses.get(id)!;
        expect(playerBonuses).toHaveLength(1);
        expect(playerBonuses[0].goodType).toBe('BREAD');
        expect(playerBonuses[0].title).toBe('TIED_KING');
        expect(playerBonuses[0].points).toBe(6); // 25 / 4 floored = 6
      }
    });

    it('3-way Queen Tie: King receives full King bonus, Queens split floored Queen bonus', () => {
      // Apple King = 20, Apple Queen = 10
      // P1 has 5 Apples (King: 20 pts)
      // P2, P3, P4 tie with 3 Apples each (Queen split: 10 / 3 = 3 pts each)
      const p1: PlayerStandInput = {
        id: 'p1',
        name: 'P1',
        gold: 0,
        standLegal: Array.from({ length: 5 }, (_, i) => makeLegal(`a1_${i}`, 'APPLE')),
        standContraband: [],
      };
      const p2: PlayerStandInput = {
        id: 'p2',
        name: 'P2',
        gold: 0,
        standLegal: Array.from({ length: 3 }, (_, i) => makeLegal(`a2_${i}`, 'APPLE')),
        standContraband: [],
      };
      const p3: PlayerStandInput = {
        id: 'p3',
        name: 'P3',
        gold: 0,
        standLegal: Array.from({ length: 3 }, (_, i) => makeLegal(`a3_${i}`, 'APPLE')),
        standContraband: [],
      };
      const p4: PlayerStandInput = {
        id: 'p4',
        name: 'P4',
        gold: 0,
        standLegal: Array.from({ length: 3 }, (_, i) => makeLegal(`a4_${i}`, 'APPLE')),
        standContraband: [],
      };

      const bonuses = calculateKingQueenBonuses([p1, p2, p3, p4]);

      expect(bonuses.get('p1')![0]).toEqual({ goodType: 'APPLE', title: 'KING', points: 20 });
      expect(bonuses.get('p2')![0]).toEqual({ goodType: 'APPLE', title: 'TIED_QUEEN', points: 3 });
      expect(bonuses.get('p3')![0]).toEqual({ goodType: 'APPLE', title: 'TIED_QUEEN', points: 3 });
      expect(bonuses.get('p4')![0]).toEqual({ goodType: 'APPLE', title: 'TIED_QUEEN', points: 3 });
    });

    it('Zero Goods rule: A player with 0 of a good type cannot receive bonus even if uncontested', () => {
      // P1 has 2 Cheese, P2 and P3 have 0 Cheese
      const p1: PlayerStandInput = { id: 'p1', name: 'P1', gold: 0, standLegal: [makeLegal('c1', 'CHEESE'), makeLegal('c2', 'CHEESE')], standContraband: [] };
      const p2: PlayerStandInput = { id: 'p2', name: 'P2', gold: 0, standLegal: [], standContraband: [] };
      const p3: PlayerStandInput = { id: 'p3', name: 'P3', gold: 0, standLegal: [], standContraband: [] };

      const bonuses = calculateKingQueenBonuses([p1, p2, p3]);

      expect(bonuses.get('p1')!).toHaveLength(1);
      expect(bonuses.get('p1')![0].title).toBe('KING');
      // P2 and P3 get NOTHING for Queen because count is 0
      expect(bonuses.get('p2')!).toHaveLength(0);
      expect(bonuses.get('p3')!).toHaveLength(0);
    });

    it('Full Tiebreak Hierarchy: Total Score -> Legal Goods -> Contraband Goods -> Shared Victory', () => {
      // P1 and P2 tie on total score (70 pts)
      // P1: 40 gold + 5 Apples (10 pts) + 20 King bonus = 70 pts, 5 legal, 0 contraband
      // P2: 30 gold + 4 Chickens (16 pts) + 14 pts contraband + 10 King bonus = 70 pts, 4 legal, 2 contraband
      const p1: PlayerStandInput = {
        id: 'p1',
        name: 'P1',
        gold: 40,
        standLegal: Array.from({ length: 5 }, (_, i) => makeLegal(`p1_a_${i}`, 'APPLE')),
        standContraband: [],
      };
      const p2: PlayerStandInput = {
        id: 'p2',
        name: 'P2',
        gold: 30,
        standLegal: Array.from({ length: 4 }, (_, i) => makeLegal(`p2_ch_${i}`, 'CHICKEN')),
        standContraband: [makeContraband('p2_p1', 'PEPPER', 7), makeContraband('p2_p2', 'PEPPER', 7)],
      };

      const scores = calculateScores([p2, p1]);
      expect(scores[0].totalScore).toBe(70);
      expect(scores[1].totalScore).toBe(70);
      // P1 wins tiebreak 1 because legalGoodsCount (5) > (4)
      expect(scores[0].playerId).toBe('p1');
      expect(scores[0].rank).toBe(1);
      expect(scores[1].playerId).toBe('p2');
      expect(scores[1].rank).toBe(2);
    });

    it('Exact Tie on Points, Legal Goods, and Contraband: Awards Shared Victory (rank 1 to both)', () => {
      // Both players end with identical total score, legal goods count, and contraband count
      const p1: PlayerStandInput = {
        id: 'p1',
        name: 'P1',
        gold: 50,
        standLegal: [makeLegal('p1_a_1', 'APPLE'), makeLegal('p1_a_2', 'APPLE')],
        standContraband: [makeContraband('p1_c_1', 'PEPPER', 6)],
      };
      const p2: PlayerStandInput = {
        id: 'p2',
        name: 'P2',
        gold: 50,
        standLegal: [makeLegal('p2_a_1', 'APPLE'), makeLegal('p2_a_2', 'APPLE')],
        standContraband: [makeContraband('p2_c_1', 'PEPPER', 6)],
      };

      const scores = calculateScores([p1, p2]);
      expect(scores[0].totalScore).toBe(scores[1].totalScore);
      expect(scores[0].legalGoodsCount).toBe(scores[1].legalGoodsCount);
      expect(scores[0].contrabandCount).toBe(scores[1].contrabandCount);
      expect(scores[0].rank).toBe(1);
      expect(scores[1].rank).toBe(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Debt Resolution Compliance                                                 */
  /* -------------------------------------------------------------------------- */
  describe('Rulebook: Debt Resolution (Overpayment does not yield change)', () => {
    it('liquidates stand goods when player lacks gold; no change given for overpayment', () => {
      const debtor = {
        id: 'debtor_1',
        gold: 0,
        standLegal: [makeLegal('ch1', 'CHICKEN')], // value 4
        standContraband: [],
      };
      const creditor = {
        id: 'creditor_1',
        gold: 10,
        standLegal: [],
        standContraband: [],
      };
      // Fine is 3 gold. Debtor has 0 gold, gives Chicken (value 4)
      const result = resolveDebt(debtor, creditor, 3);

      expect(result.settled).toBe(true);
      expect(result.paidGold).toBe(0);
      expect(result.remainingDebt).toBe(0);
      expect(result.transferredLegalCards).toHaveLength(1);
      expect(result.transferredLegalCards[0].id).toBe('ch1');
      // Overpayment does NOT return change: debtor gold remains 0
      expect(result.debtor.gold).toBe(0);
      expect(result.creditor.gold).toBe(10);
      expect(result.creditor.standLegal.map((c) => c.id)).toContain('ch1');
    });
  });
});
