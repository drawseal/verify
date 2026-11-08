import { describe, expect, it } from 'vitest';
import { instantCatchup } from './instant-catchup.js';

const base = {
  serverSeed: 'a3f1c0b27e4d9a15',
  catchupDrandValue: '77aa'.repeat(16),
  weightingMode: 'equal' as const,
  sealedValidIds: ['a', 'b', 'c', 'd', 'e'],
  referrals: ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id,
    referredByParticipantId: null,
    suppliedEntries: 1,
  })),
  referralBonusEntries: 0,
  alreadyWinningIds: ['a'],
  vacantRanks: [2, 3],
};

describe('instantCatchup', () => {
  it('pourvoit les rangs vacants, dans l’ordre des rangs', () => {
    const res = instantCatchup(base);
    expect(res.winners.map((w) => w.rank)).toEqual([2, 3]);
    expect(res.stillVacantRanks).toEqual([]);
  });

  /**
   * BLOQUANT. Une participation déjà gagnante ne peut pas regagner, et deux rangs vacants ne
   * peuvent pas échoir à la même personne : c'est l'exclusion cumulative qui les sépare.
   */
  it('BLOQUANT : ne désigne jamais deux fois la même participation', () => {
    const res = instantCatchup(base);
    const ids = res.winners.map((w) => w.participantId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('a');
  });

  /** Déterministe : les mêmes entrées publiées donnent le même résultat, pour tout le monde. */
  it('BLOQUANT : rejoué, il redonne exactement le même résultat', () => {
    expect(instantCatchup(base)).toEqual(instantCatchup(base));
  });

  /**
   * Un autre hasard public donne d'autres gagnants : le rattrapage dépend bien du round engagé,
   * et non de l'ordre du pool.
   */
  it('suit le round de rattrapage', () => {
    const autre = instantCatchup({ ...base, catchupDrandValue: '88bb'.repeat(16) });
    expect(autre.winners).not.toEqual(instantCatchup(base).winners);
  });

  /**
   * Plus personne à tirer : le rang reste vacant, et c'est publié. Le taire laisserait croire à
   * un lot attribué qui ne l'est pas.
   */
  it('BLOQUANT : rend les rangs qu’il n’a pas pu pourvoir', () => {
    const res = instantCatchup({
      ...base,
      sealedValidIds: ['a', 'b'],
      referrals: [
        { id: 'a', referredByParticipantId: null, suppliedEntries: 1 },
        { id: 'b', referredByParticipantId: null, suppliedEntries: 1 },
      ],
      vacantRanks: [2, 3],
    });
    expect(res.winners).toHaveLength(1);
    expect(res.stillVacantRanks).toEqual([3]);
  });

  it('ne fait rien quand aucun rang n’est vacant', () => {
    expect(instantCatchup({ ...base, vacantRanks: [] })).toEqual({
      winners: [],
      stillVacantRanks: [],
    });
  });
});
