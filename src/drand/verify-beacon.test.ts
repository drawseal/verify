import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { roundToMessage, verifyBeacon } from './verify-beacon.js';
import type { DrandBeacon } from './chain-info.js';

// Vecteur réel quicknet (round 1 000 000), figé pour une vérification offline.
const REAL: DrandBeacon = {
  round: 1_000_000,
  randomness: 'b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
  signature:
    '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
};

describe('roundToMessage', () => {
  it('encode le round en sha256(uint64 big-endian) — vecteur réel', () => {
    expect(bytesToHex(roundToMessage(1_000_000))).toBe(
      'ce59b701970051bef0d7efdc1a4196c49ce1bbaaf9c5403626ad7adcc41737e7',
    );
  });
});

describe('verifyBeacon', () => {
  it('valide un beacon quicknet authentique', () => {
    expect(verifyBeacon(REAL)).toBe(true);
  });

  it('rejette une signature altérée', () => {
    const tampered = { ...REAL, signature: REAL.signature.replace(/^83ad/, '83ae') };
    expect(verifyBeacon(tampered)).toBe(false);
  });

  it('rejette une randomness altérée (intégrité)', () => {
    const tampered = { ...REAL, randomness: 'f'.repeat(64) };
    expect(verifyBeacon(tampered)).toBe(false);
  });

  it('rejette un round incohérent avec la signature', () => {
    const tampered = { ...REAL, round: 999_999 };
    expect(verifyBeacon(tampered)).toBe(false);
  });

  it('renvoie false (sans throw) sur une signature non hexadécimale / hors courbe', () => {
    expect(verifyBeacon({ ...REAL, signature: 'zz' })).toBe(false);
    expect(verifyBeacon({ ...REAL, signature: '00' })).toBe(false);
  });
});
