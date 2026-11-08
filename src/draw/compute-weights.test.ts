import { describe, expect, it } from 'vitest';
import {
  computeWeights,
  REFERRAL_BONUS_CAP,
  REFERRAL_CAP_ALGORITHM_VERSION,
  referralBonusCapFor,
} from './compute-weights.js';

const participants = [
  { id: 'a', referredByParticipantId: null, suppliedEntries: 5 },
  { id: 'b', referredByParticipantId: 'a', suppliedEntries: 1 }, // filleul de a
  { id: 'c', referredByParticipantId: 'a', suppliedEntries: 3 }, // filleul de a
  { id: 'd', referredByParticipantId: 'excluded', suppliedEntries: 1 }, // parrain non valide
];

describe('computeWeights', () => {
  it('mode equal : tous les poids valent 1', () => {
    const out = computeWeights({
      weightingMode: 'equal',
      validIds: ['a', 'b', 'c'],
      participants,
      referralBonusEntries: 5,
    });
    expect(out).toEqual([
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ]);
  });

  it('mode weighted : 1 + bonus × filleuls valides', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds: ['a', 'b', 'c'],
      participants,
      referralBonusEntries: 2,
    });
    // a a 2 filleuls valides (b, c) → 1 + 2×2 = 5 ; b et c → 1.
    expect(out.find((p) => p.id === 'a')?.weight).toBe(5);
    expect(out.find((p) => p.id === 'b')?.weight).toBe(1);
    expect(out.find((p) => p.id === 'c')?.weight).toBe(1);
  });

  it('ne compte pas un filleul exclu de la liste valide', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds: ['a', 'b'], // c exclu
      participants,
      referralBonusEntries: 3,
    });
    // a n'a plus qu'un filleul valide (b) → 1 + 3×1 = 4.
    expect(out.find((p) => p.id === 'a')?.weight).toBe(4);
  });

  it('bonus de parrainage à 0 → poids 1 même en weighted', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds: ['a', 'b', 'c'],
      participants,
      referralBonusEntries: 0,
    });
    expect(out.every((p) => p.weight === 1)).toBe(true);
  });
});

describe('computeWeights — mode supplied', () => {
  it('reprend le nombre d’entrées porté par le participant', () => {
    const out = computeWeights({
      weightingMode: 'supplied',
      validIds: ['a', 'b', 'c'],
      participants,
      referralBonusEntries: 5,
    });
    expect(out).toEqual([
      { id: 'a', weight: 5 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 3 },
    ]);
  });

  it('ignore le parrainage : seules les entrées fournies comptent', () => {
    const out = computeWeights({
      weightingMode: 'supplied',
      validIds: ['a'],
      participants,
      referralBonusEntries: 100,
    });
    expect(out).toEqual([{ id: 'a', weight: 5 }]);
  });

  it('retombe à 1 pour un id absent de la liste des participants', () => {
    const out = computeWeights({
      weightingMode: 'supplied',
      validIds: ['inconnu'],
      participants,
      referralBonusEntries: 0,
    });
    expect(out).toEqual([{ id: 'inconnu', weight: 1 }]);
  });
});

/**
 * Plafond du bonus de parrainage (algorithme v4).
 *
 * Sans plafond, une seule personne qui accumule des filleuls — ou des participations qui se
 * parrainent entre elles — pèse sans borne face à un participant honnête. Le plafond borne ce
 * que le parrainage ajoute à une participation ; il ne s'applique qu'aux documents qui le
 * déclarent, pour que les tirages scellés avant lui se rejouent à l'identique.
 */
describe('computeWeights — plafond du bonus de parrainage', () => {
  const sixFilleuls = [
    { id: 'p', referredByParticipantId: null, suppliedEntries: 1 },
    ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => ({
      id,
      referredByParticipantId: 'p',
      suppliedEntries: 1,
    })),
  ];
  const validIds = sixFilleuls.map((p) => p.id);

  it('vaut +5 et ne s’applique qu’à partir de la version 4', () => {
    expect(REFERRAL_BONUS_CAP).toBe(5);
    expect(REFERRAL_CAP_ALGORITHM_VERSION).toBe(4);
    expect(referralBonusCapFor(1)).toBeNull();
    expect(referralBonusCapFor(3)).toBeNull();
    expect(referralBonusCapFor(4)).toBe(5);
  });

  it('BLOQUANT : borne le bonus d’une participation au plafond', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds,
      participants: sixFilleuls,
      referralBonusEntries: 2,
      referralBonusCap: REFERRAL_BONUS_CAP,
    });
    // 6 filleuls × 2 = 12, plafonné à 5 → 1 + 5.
    expect(out.find((p) => p.id === 'p')?.weight).toBe(6);
  });

  it('borne aussi un bonus unitaire supérieur au plafond', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds: ['p', 'f1'],
      participants: sixFilleuls,
      referralBonusEntries: 10,
      referralBonusCap: REFERRAL_BONUS_CAP,
    });
    expect(out.find((p) => p.id === 'p')?.weight).toBe(6);
  });

  it('laisse intact un bonus sous le plafond', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds: ['p', 'f1', 'f2'],
      participants: sixFilleuls,
      referralBonusEntries: 2,
      referralBonusCap: REFERRAL_BONUS_CAP,
    });
    expect(out.find((p) => p.id === 'p')?.weight).toBe(5);
  });

  it('BLOQUANT : sans plafond déclaré, le poids historique est rejoué à l’identique', () => {
    const out = computeWeights({
      weightingMode: 'weighted',
      validIds,
      participants: sixFilleuls,
      referralBonusEntries: 2,
    });
    expect(out.find((p) => p.id === 'p')?.weight).toBe(13);
    const explicitNull = computeWeights({
      weightingMode: 'weighted',
      validIds,
      participants: sixFilleuls,
      referralBonusEntries: 2,
      referralBonusCap: null,
    });
    expect(explicitNull).toEqual(out);
  });

  it('ne touche pas au mode supplied', () => {
    const out = computeWeights({
      weightingMode: 'supplied',
      validIds: ['p'],
      participants: [{ id: 'p', referredByParticipantId: null, suppliedEntries: 40 }],
      referralBonusEntries: 2,
      referralBonusCap: REFERRAL_BONUS_CAP,
    });
    expect(out).toEqual([{ id: 'p', weight: 40 }]);
  });
});
