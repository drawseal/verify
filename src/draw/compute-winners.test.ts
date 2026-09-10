import { describe, it, expect } from 'vitest';
import {
  computeWinners,
  computeRankFinalHash,
  generateServerSeed,
  commitServerSeed,
} from './compute-winners.js';
import { computeFingerprint } from './pool.js';
import { DrawEngineError } from './errors.js';
import { sha256Hex } from './hash.js';
import type { DrawInput } from './compute-winners.js';
import type { PoolParticipant } from './pool.js';

const participants: PoolParticipant[] = [
  { id: 'p1', weight: 1 },
  { id: 'p2', weight: 1 },
  { id: 'p3', weight: 1 },
  { id: 'p4', weight: 1 },
  { id: 'p5', weight: 1 },
];

const input: DrawInput = {
  serverSeed: 'a'.repeat(64),
  drandValue: 'b'.repeat(64),
  winnersCount: 3,
  participants,
};

describe('generateServerSeed / commitServerSeed', () => {
  it('generateServerSeed produit 64 caractères hex', () => {
    expect(generateServerSeed()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deux graines générées diffèrent', () => {
    expect(generateServerSeed()).not.toBe(generateServerSeed());
  });

  it('commitServerSeed = sha256Hex(seed)', () => {
    const seed = generateServerSeed();
    expect(commitServerSeed(seed)).toMatch(/^[0-9a-f]{64}$/);
    expect(commitServerSeed(seed)).toBe(commitServerSeed(seed));
  });
});

describe('computeWinners — déterminisme', () => {
  it('mêmes graines → mêmes gagnants (rejouable)', () => {
    const a = computeWinners(input);
    const b = computeWinners(input);
    expect(b.winners).toEqual(a.winners);
    expect(b.participantsFingerprint).toBe(a.participantsFingerprint);
  });

  it('est insensible à l’ordre du tableau d’entrée', () => {
    const shuffled: DrawInput = { ...input, participants: [...participants].reverse() };
    expect(computeWinners(shuffled).winners).toEqual(computeWinners(input).winners);
  });
});

describe('computeWinners — cascade', () => {
  it('désigne exactement winnersCount gagnants distincts', () => {
    const { winners } = computeWinners(input);
    expect(winners).toHaveLength(3);
    const ids = winners.map((w) => w.participantId);
    expect(new Set(ids).size).toBe(3);
  });

  it('produit des rangs 1..N contigus', () => {
    const { winners } = computeWinners(input);
    expect(winners.map((w) => w.rank)).toEqual([1, 2, 3]);
  });

  it('chaque gagnant porte un finalHash de trace', () => {
    for (const w of computeWinners(input).winners) {
      expect(w.finalHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('l’empreinte est celle de la liste complète (inchangée par la cascade)', () => {
    expect(computeWinners(input).participantsFingerprint).toBe(computeFingerprint(participants));
  });
});

describe('computeWinners — validation', () => {
  it('rejette winnersCount < 1', () => {
    expect(() => computeWinners({ ...input, winnersCount: 0 })).toThrow(DrawEngineError);
  });

  it('rejette winnersCount > nombre de participants', () => {
    expect(() => computeWinners({ ...input, winnersCount: 6 })).toThrow(DrawEngineError);
  });

  it('rejette un pool vide', () => {
    expect(() => computeWinners({ ...input, participants: [], winnersCount: 1 })).toThrow(
      DrawEngineError,
    );
  });

  it('rejette un pool invalide (poids ≤ 0)', () => {
    expect(() =>
      computeWinners({ ...input, participants: [{ id: 'x', weight: 0 }], winnersCount: 1 }),
    ).toThrow(DrawEngineError);
  });
});

describe('computeRankFinalHash', () => {
  const participants = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 2 },
    { id: 'c', weight: 1 },
  ];

  it('reproduit exactement les empreintes rendues par computeWinners', () => {
    const fingerprint = computeFingerprint(participants);
    const outcome = computeWinners({
      serverSeed: 'seed',
      drandValue: 'drand',
      winnersCount: 3,
      participants,
    });
    for (const winner of outcome.winners) {
      expect(computeRankFinalHash('seed', 'drand', winner.rank, fingerprint)).toBe(
        winner.finalHash,
      );
    }
  });

  it('conserve la formule publiée (séparateurs explicites)', () => {
    expect(computeRankFinalHash('s', 'd', 2, 'f')).toBe(sha256Hex('s|d|2|f'));
  });

  it('est déterministe et distincte par rang', () => {
    expect(computeRankFinalHash('s', 'd', 1, 'f')).toBe(computeRankFinalHash('s', 'd', 1, 'f'));
    expect(computeRankFinalHash('s', 'd', 1, 'f')).not.toBe(computeRankFinalHash('s', 'd', 2, 'f'));
  });
});
