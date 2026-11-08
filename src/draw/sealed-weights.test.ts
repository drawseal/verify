import { describe, expect, it } from 'vitest';
import { REFERRAL_BONUS_CAP } from './compute-weights.js';
import { referralsReproduceSealedWeights } from './sealed-weights.js';

/**
 * Un pool scellé sous le plafond de parrainage (v4) ne se reproduit qu'avec ce plafond, et un pool
 * scellé avant lui ne se reproduit que sans : c'est ce qui garde vérifiables, côte à côte, les
 * tirages d'avant et d'après la règle.
 */
describe('referralsReproduceSealedWeights — plafond du bonus de parrainage', () => {
  const referrals = [
    { id: 'p', referredByParticipantId: null, suppliedEntries: 1 },
    { id: 'f1', referredByParticipantId: 'p', suppliedEntries: 1 },
    { id: 'f2', referredByParticipantId: 'p', suppliedEntries: 1 },
    { id: 'f3', referredByParticipantId: 'p', suppliedEntries: 1 },
  ];
  const tail = [
    { id: 'f1', weight: 1 },
    { id: 'f2', weight: 1 },
    { id: 'f3', weight: 1 },
  ];

  it('BLOQUANT : un pool plafonné se reproduit avec le plafond, pas sans', () => {
    // 3 filleuls × 3 = 9, plafonné à 5 → 6.
    const sealed = [{ id: 'p', weight: 6 }, ...tail];
    expect(
      referralsReproduceSealedWeights(sealed, 'weighted', referrals, 3, REFERRAL_BONUS_CAP),
    ).toBe(true);
    expect(referralsReproduceSealedWeights(sealed, 'weighted', referrals, 3)).toBe(false);
  });

  it('BLOQUANT : un pool scellé avant le plafond se reproduit toujours sans lui', () => {
    const sealed = [{ id: 'p', weight: 10 }, ...tail];
    expect(referralsReproduceSealedWeights(sealed, 'weighted', referrals, 3)).toBe(true);
    expect(referralsReproduceSealedWeights(sealed, 'weighted', referrals, 3, null)).toBe(true);
  });
});
