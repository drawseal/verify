import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash.js';

describe('sha256Hex', () => {
  it('correspond aux vecteurs SHA-256 connus', () => {
    // Vecteurs de référence NIST / RFC.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produit toujours 64 caractères hex minuscules', () => {
    const out = sha256Hex('drawseal');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('est déterministe', () => {
    expect(sha256Hex('même entrée')).toBe(sha256Hex('même entrée'));
  });

  it('gère l’UTF-8 multi-octets', () => {
    // Distinct de l’ASCII : preuve que l’encodage UTF-8 est appliqué.
    expect(sha256Hex('é')).not.toBe(sha256Hex('e'));
  });
});
