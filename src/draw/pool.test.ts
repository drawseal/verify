import { describe, it, expect } from 'vitest';
import { canonicalize, computeFingerprint, assertValidPool } from './pool.js';
import { DrawEngineError } from './errors.js';
import type { PoolParticipant } from './pool.js';

const pool: PoolParticipant[] = [
  { id: 'c', weight: 1 },
  { id: 'a', weight: 2 },
  { id: 'b', weight: 3 },
];

describe('canonicalize', () => {
  it('trie par id croissant sans muter l’entrée', () => {
    const input = [...pool];
    const out = canonicalize(input);
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((p) => p.id)).toEqual(['c', 'a', 'b']); // entrée intacte
  });
});

describe('computeFingerprint', () => {
  it('est insensible à l’ordre du tableau d’entrée', () => {
    const shuffled = [pool[2], pool[0], pool[1]];
    expect(computeFingerprint(pool)).toBe(computeFingerprint(shuffled));
  });

  it('change si un poids change', () => {
    const altered = pool.map((p) => (p.id === 'a' ? { ...p, weight: 99 } : p));
    expect(computeFingerprint(altered)).not.toBe(computeFingerprint(pool));
  });

  it('ne dépend que de (id, weight) — aucun champ superflu (RGPD)', () => {
    // Un email attaché à l’objet ne doit JAMAIS influencer l’empreinte :
    // preuve structurelle que l’empreinte est publiable sans fuite.
    const withEmail = pool.map((p) => ({ ...p, email: `${p.id}@example.com` }));
    expect(computeFingerprint(withEmail as PoolParticipant[])).toBe(computeFingerprint(pool));
  });
});

describe('assertValidPool', () => {
  it('accepte un pool valide', () => {
    expect(() => assertValidPool(pool)).not.toThrow();
  });

  it('rejette un pool vide', () => {
    expect(() => assertValidPool([])).toThrow(DrawEngineError);
  });

  it('rejette un poids non entier', () => {
    expect(() => assertValidPool([{ id: 'a', weight: 1.5 }])).toThrow(DrawEngineError);
  });

  it('rejette un poids ≤ 0', () => {
    expect(() => assertValidPool([{ id: 'a', weight: 0 }])).toThrow(DrawEngineError);
    expect(() => assertValidPool([{ id: 'a', weight: -1 }])).toThrow(DrawEngineError);
  });

  it('rejette des id dupliqués', () => {
    expect(() =>
      assertValidPool([
        { id: 'a', weight: 1 },
        { id: 'a', weight: 2 },
      ]),
    ).toThrow(DrawEngineError);
  });
});
