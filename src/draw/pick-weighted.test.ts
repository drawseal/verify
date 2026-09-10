import { describe, it, expect } from 'vitest';
import { pickWeighted } from './pick-weighted.js';
import { sha256Hex } from './hash.js';
import { DrawEngineError } from './errors.js';
import type { PoolParticipant } from './pool.js';

// Canonique : a[0,2) b[2,5) c[5,6), total = 6.
const pool: PoolParticipant[] = [
  { id: 'b', weight: 3 },
  { id: 'a', weight: 2 },
  { id: 'c', weight: 1 },
];

/** finalHash dont la valeur entière vaut exactement `target` (< total ≪ 2²⁵⁶). */
const hashForTarget = (target: number) => target.toString(16);

describe('pickWeighted — bornes', () => {
  it('target = 0 → premier de l’ordre canonique', () => {
    expect(pickWeighted(pool, hashForTarget(0)).id).toBe('a');
  });

  it('target = total - 1 → dernier de l’ordre canonique', () => {
    expect(pickWeighted(pool, hashForTarget(5)).id).toBe('c');
  });

  it('respecte les frontières cumulées [cumStart, cumStart+weight)', () => {
    expect(pickWeighted(pool, hashForTarget(1)).id).toBe('a'); // fin de a
    expect(pickWeighted(pool, hashForTarget(2)).id).toBe('b'); // début de b
    expect(pickWeighted(pool, hashForTarget(4)).id).toBe('b'); // fin de b
    expect(pickWeighted(pool, hashForTarget(5)).id).toBe('c'); // début de c
  });
});

describe('pickWeighted — déterminisme & cas limites', () => {
  it('même finalHash → même participant', () => {
    const h = sha256Hex('graine');
    expect(pickWeighted(pool, h).id).toBe(pickWeighted(pool, h).id);
  });

  it('pool à 1 participant → toujours lui', () => {
    const solo: PoolParticipant[] = [{ id: 'solo', weight: 7 }];
    expect(pickWeighted(solo, sha256Hex('x')).id).toBe('solo');
  });

  it('rejette un finalHash non hexadécimal', () => {
    expect(() => pickWeighted(pool, 'nope!')).toThrow(DrawEngineError);
  });

  it('rejette un pool invalide (propage la validation)', () => {
    expect(() => pickWeighted([], hashForTarget(0))).toThrow(DrawEngineError);
  });
});

describe('pickWeighted — pondération statistique', () => {
  it('la fréquence de sélection ≈ weight / total', () => {
    const N = 12_000;
    const total = 6;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < N; i++) {
      counts[pickWeighted(pool, sha256Hex(`iter|${i}`)).id]++;
    }
    const expected: Record<string, number> = { a: 2 / total, b: 3 / total, c: 1 / total };
    for (const id of ['a', 'b', 'c']) {
      const freq = counts[id] / N;
      expect(Math.abs(freq - expected[id])).toBeLessThan(0.03); // tolérance statistique
    }
  });
});
