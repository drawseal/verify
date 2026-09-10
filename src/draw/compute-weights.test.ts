import { describe, expect, it } from 'vitest';
import { computeWeights } from './compute-weights.js';

const participants = [
  { id: 'a', referredByParticipantId: null },
  { id: 'b', referredByParticipantId: 'a' }, // filleul de a
  { id: 'c', referredByParticipantId: 'a' }, // filleul de a
  { id: 'd', referredByParticipantId: 'excluded' }, // parrain non valide
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
