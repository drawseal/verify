import { describe, expect, it } from 'vitest';
import { instantDesignations } from './instant-designations.js';
import { instantWinningPositions } from './instant-win.js';

const SEED = 'a3f1c0b27e4d9a15';
const DRAND = '8f2c1d4e7b0a9635';
const MAX = 500;
const LOTS = 3;
const POSITIONS = instantWinningPositions(SEED, DRAND, MAX, LOTS);

function base(over: Partial<Parameters<typeof instantDesignations>[0]> = {}) {
  return {
    serverSeed: SEED,
    drandValue: DRAND,
    maxEntries: MAX,
    prizesCount: LOTS,
    entryPositions: POSITIONS.map((position, i) => ({ id: `p${i}`, position })),
    eligibleIds: POSITIONS.map((_, i) => `p${i}`),
    ...over,
  };
}

describe('instantDesignations', () => {
  /**
   * La règle de rattachement : la plus petite position gagne le lot 1. Déterministe, sans donnée
   * supplémentaire — un vérificateur la reconstitue à partir des seules positions qu'il recalcule.
   */
  it('BLOQUANT : la plus petite position gagne le premier lot', () => {
    const res = instantDesignations(base());
    expect(res.positions).toEqual([...POSITIONS].sort((a, b) => a - b));
    expect(res.designations.map((d) => d.rank)).toEqual([1, 2, 3]);
    expect(res.designations.map((d) => d.participantId)).toEqual(['p0', 'p1', 'p2']);
    expect(res.vacantRanks).toEqual([]);
  });

  /**
   * Le cas qui a lancé ce travail : une position gagnante que personne n'atteint. Le rang reste
   * vacant, et c'est démontré — pas affirmé.
   */
  it('BLOQUANT : laisse vacant un rang dont la position n’est atteinte par personne', () => {
    const res = instantDesignations(
      base({ entryPositions: [{ id: 'p0', position: POSITIONS[0] }], eligibleIds: ['p0'] }),
    );
    expect(res.designations[0].participantId).toBe('p0');
    expect(res.vacantRanks).toEqual([2, 3]);
  });

  /**
   * BLOQUANT. La condition de remise est annoncée au règlement : adresse confirmée, non écartée
   * par l'anti-fraude. Une position tenue par une participation inéligible laisse son rang vacant
   * — et le rang n'est JAMAIS décalé sur le suivant, ce qui donnerait un lot que la position ne
   * donnait pas.
   */
  it('BLOQUANT : une position tenue par une participation inéligible laisse le rang vacant', () => {
    const res = instantDesignations(base({ eligibleIds: ['p1', 'p2'] }));
    expect(res.designations[0].participantId).toBeNull();
    expect(res.designations[1].participantId).toBe('p1');
    expect(res.vacantRanks).toEqual([1]);
  });

  /** Une graine différente donne d'autres positions : le rattachement suit, il n'est pas figé. */
  it('suit la graine : un autre engagement donne d’autres gagnants', () => {
    const autres = instantWinningPositions('a3f1c0b27e4d9a16', DRAND, MAX, LOTS);
    expect(autres).not.toEqual(POSITIONS);
    const res = instantDesignations(base({ serverSeed: 'a3f1c0b27e4d9a16' }));
    expect(res.positions).toEqual(autres);
  });
});
