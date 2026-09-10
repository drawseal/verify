import { describe, expect, it } from 'vitest';
import { ALGORITHM_VERSION, checkAlgorithmVersion } from './algorithm-version.js';

describe('checkAlgorithmVersion', () => {
  it('accepte un document produit par la même version', () => {
    expect(checkAlgorithmVersion(ALGORITHM_VERSION)).toEqual({ canVerify: true });
  });

  it('accepte un document plus ancien : les règles passées restent rejouables', () => {
    expect(checkAlgorithmVersion(ALGORITHM_VERSION - 1)).toEqual({ canVerify: true });
  });

  it("BLOQUANT : refuse de conclure sur un document plus récent que lui, plutôt que d'accuser", () => {
    const verdict = checkAlgorithmVersion(ALGORITHM_VERSION + 1);
    expect(verdict).toEqual({
      canVerify: false,
      declared: ALGORITHM_VERSION + 1,
      supported: ALGORITHM_VERSION,
      reason: 'verifier-too-old',
    });
  });

  it('nomme la version qui manque, pour que le message soit actionnable', () => {
    const verdict = checkAlgorithmVersion(ALGORITHM_VERSION + 5);
    expect(verdict.canVerify).toBe(false);
    if (!verdict.canVerify) {
      expect(verdict.declared).toBe(ALGORITHM_VERSION + 5);
      expect(verdict.supported).toBe(ALGORITHM_VERSION);
    }
  });

  it('la version est un entier positif', () => {
    expect(Number.isInteger(ALGORITHM_VERSION)).toBe(true);
    expect(ALGORITHM_VERSION).toBeGreaterThan(0);
  });
});
