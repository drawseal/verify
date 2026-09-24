import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../draw/hash.js';
import { DrawEngineError } from '../draw/errors.js';
import { instantWinningPositions, isInstantWinner, verifyInstantDraw } from './instant-win.js';

const SEED = 'a'.repeat(64);
const DRAND = 'b'.repeat(64);

describe('instantWinningPositions', () => {
  /** L'invariant fondateur : deux exécutions doivent donner exactement le même ensemble. */
  it('BLOQUANT : est déterministe', () => {
    expect(instantWinningPositions(SEED, DRAND, 1000, 5)).toEqual(
      instantWinningPositions(SEED, DRAND, 1000, 5),
    );
  });

  /**
   * Le nombre de lots est une promesse faite aux participants avant l'ouverture. Le dépasser
   * coûterait à l'organisateur des lots qu'il n'a pas ; ne pas l'atteindre lui ferait garder des
   * lots promis.
   */
  it('BLOQUANT : distribue exactement le nombre de lots annoncé', () => {
    expect(instantWinningPositions(SEED, DRAND, 500, 7)).toHaveLength(7);
  });

  it('BLOQUANT : ne désigne jamais deux fois la même position', () => {
    const positions = instantWinningPositions(SEED, DRAND, 50, 20);
    expect(new Set(positions).size).toBe(20);
  });

  it('BLOQUANT : reste dans les bornes 1..maxEntries', () => {
    for (const position of instantWinningPositions(SEED, DRAND, 30, 10)) {
      expect(position).toBeGreaterThanOrEqual(1);
      expect(position).toBeLessThanOrEqual(30);
    }
  });

  it('rend les positions triées, pour que deux affichages ne divergent pas', () => {
    const positions = instantWinningPositions(SEED, DRAND, 200, 9);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // Changer la graine OU le drand doit tout redistribuer : sinon l'un des deux ne sert à rien.
  it('BLOQUANT : dépend de la graine autant que de l’aléa public', () => {
    const base = instantWinningPositions(SEED, DRAND, 10_000, 10);
    expect(instantWinningPositions('c'.repeat(64), DRAND, 10_000, 10)).not.toEqual(base);
    expect(instantWinningPositions(SEED, 'd'.repeat(64), 10_000, 10)).not.toEqual(base);
  });

  it('gagne à tous les coups quand il y a autant de lots que de places', () => {
    expect(instantWinningPositions(SEED, DRAND, 4, 4)).toEqual([1, 2, 3, 4]);
  });

  it('traite le cas d’un lot unique', () => {
    expect(instantWinningPositions(SEED, DRAND, 1, 1)).toEqual([1]);
  });

  /**
   * Un plafond d'un million ne doit pas coûter un tableau d'un million d'entrées pour en retenir
   * dix : le mélange est partiel et les positions sont représentées paresseusement.
   */
  it('reste praticable sur un très grand plafond', () => {
    const started = Date.now();
    const positions = instantWinningPositions(SEED, DRAND, 1_000_000, 10);
    expect(positions).toHaveLength(10);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([
    [0, 1],
    [10, 0],
    [10, 11],
    [1.5, 1],
    [10, 2.5],
  ])('refuse des bornes incohérentes (max=%s, lots=%s)', (maxEntries, prizesCount) => {
    expect(() => instantWinningPositions(SEED, DRAND, maxEntries, prizesCount)).toThrow(
      DrawEngineError,
    );
  });

  /**
   * Répartition : sur un grand nombre de tirages indépendants, aucune moitié du plafond ne doit
   * rafler nettement plus que l'autre. Ce n'est pas un test d'uniformité rigoureux, c'est un
   * garde-fou contre un biais grossier — du genre qu'un `% span` mal placé introduirait.
   */
  it('ne concentre pas les gagnants sur une moitié du plafond', () => {
    let low = 0;
    let high = 0;
    for (let i = 0; i < 400; i += 1) {
      const [position] = instantWinningPositions(`${SEED}${i}`, DRAND, 100, 1);
      if (position <= 50) {
        low += 1;
      } else {
        high += 1;
      }
    }
    expect(Math.abs(low - high)).toBeLessThan(80);
  });
});

describe('isInstantWinner', () => {
  it('répond sur l’appartenance à l’ensemble gagnant', () => {
    expect(isInstantWinner([3, 7], 7)).toBe(true);
    expect(isInstantWinner([3, 7], 8)).toBe(false);
  });
});

describe('verifyInstantDraw', () => {
  const commitment = {
    serverSeedHash: sha256Hex(SEED),
    drandRound: 1234,
    maxEntries: 500,
    prizesCount: 5,
  };

  it('confirme un instant gagnant honnête', () => {
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: SEED,
      drandValue: DRAND,
      announcedPositions: instantWinningPositions(SEED, DRAND, 500, 5),
    });
    expect(verdict.seedMatchesCommitment).toBe(true);
    expect(verdict.positionsMatch).toBe(true);
  });

  /**
   * C'est la fraude que l'engagement existe pour rendre impossible : révéler une autre graine que
   * celle engagée, choisie après coup pour désigner les gagnants voulus.
   */
  it('BLOQUANT : démasque une graine révélée qui ne correspond pas à l’engagement', () => {
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: 'f'.repeat(64),
      drandValue: DRAND,
      announcedPositions: instantWinningPositions('f'.repeat(64), DRAND, 500, 5),
    });
    expect(verdict.seedMatchesCommitment).toBe(false);
  });

  /** L'autre fraude : la graine est bien la bonne, mais les gagnants annoncés n'en découlent pas. */
  it('BLOQUANT : démasque des positions annoncées qui ne découlent pas de la graine', () => {
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: SEED,
      drandValue: DRAND,
      announcedPositions: [1, 2, 3, 4, 5],
    });
    expect(verdict.seedMatchesCommitment).toBe(true);
    expect(verdict.positionsMatch).toBe(false);
  });

  it('ne se laisse pas tromper par un ensemble annoncé dans le désordre', () => {
    const positions = instantWinningPositions(SEED, DRAND, 500, 5);
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: SEED,
      drandValue: DRAND,
      announcedPositions: [...positions].reverse(),
    });
    expect(verdict.positionsMatch).toBe(true);
  });

  it('refuse un ensemble tronqué', () => {
    const positions = instantWinningPositions(SEED, DRAND, 500, 5);
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: SEED,
      drandValue: DRAND,
      announcedPositions: positions.slice(0, 4),
    });
    expect(verdict.positionsMatch).toBe(false);
  });

  // Dire seulement « non » n'aide personne — c'est ce qu'on reproche aux boîtes noires.
  it('rend les positions attendues, pour que le désaccord soit explicable', () => {
    const verdict = verifyInstantDraw({
      commitment,
      serverSeed: SEED,
      drandValue: DRAND,
      announcedPositions: [1],
    });
    expect(verdict.expectedPositions).toEqual(instantWinningPositions(SEED, DRAND, 500, 5));
  });
});
