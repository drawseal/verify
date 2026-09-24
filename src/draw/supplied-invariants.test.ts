import { describe, expect, it } from 'vitest';
import { computeWeights } from './compute-weights.js';
import { canonicalize, computeFingerprint } from './pool.js';
import { computeWinners } from './compute-winners.js';
import type { DrawInput } from './compute-winners.js';

const participants = [
  { id: 'a', referredByParticipantId: null, suppliedEntries: 5 },
  { id: 'b', referredByParticipantId: null, suppliedEntries: 1 },
  { id: 'c', referredByParticipantId: null, suppliedEntries: 4 },
];

const poolOf = (ids: string[]) =>
  computeWeights({
    weightingMode: 'supplied',
    validIds: ids,
    participants,
    referralBonusEntries: 0,
  });

describe('invariants du mode supplied', () => {
  it('rejoué avec les mêmes graines, désigne toujours le même gagnant', () => {
    const pool = poolOf(['a', 'b', 'c']);
    const args: DrawInput = {
      serverSeed: 'graine-fixe',
      drandValue: 'aleas-fixe',
      winnersCount: 1,
      participants: pool,
    };
    expect(computeWinners(args)).toEqual(computeWinners(args));
  });

  it("le sceau ne dépend pas de l'ordre d'import", () => {
    const direct = poolOf(['a', 'b', 'c']);
    const inverse = poolOf(['c', 'b', 'a']);
    expect(computeFingerprint(direct)).toBe(computeFingerprint(inverse));
    expect(canonicalize(direct)).toEqual(canonicalize(inverse));
  });

  it('un participant à 5 entrées gagne environ 5 fois plus qu’un participant à 1', () => {
    const pool = poolOf(['a', 'b']); // a: 5 entrées, b: 1
    const wins = { a: 0, b: 0 };
    for (let i = 0; i < 6000; i += 1) {
      const { winners } = computeWinners({
        serverSeed: `graine-${i}`,
        drandValue: `aleas-${i}`,
        winnersCount: 1,
        participants: pool,
      });
      wins[winners[0].participantId as 'a' | 'b'] += 1;
    }
    // Attendu : 5/6 ≈ 5000 contre 1/6 ≈ 1000. Les bornes sont larges à dessein — ce test mesure
    // que la pondération s'applique, pas la qualité du générateur, déjà couverte ailleurs.
    expect(wins.a / wins.b).toBeGreaterThan(3.5);
    expect(wins.a / wins.b).toBeLessThan(7);
  });
});
