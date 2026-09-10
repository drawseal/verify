import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { QUICKNET_CHAIN_INFO } from './chain-info.js';
import type { DrandBeacon, DrandChainInfo } from './chain-info.js';

const { shortSignatures } = bls12_381;

/**
 * Message signé par drand pour un round **unchained** : `sha256` de l'entier
 * `round` encodé en `uint64` big-endian (8 octets).
 */
export function roundToMessage(round: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(round), false);
  return sha256(buf);
}

/**
 * Vérifie l'authenticité d'un beacon drand (round ↔ valeur). Ne **throw pas** :
 * renvoie un booléen (un beacon invalide est un résultat à afficher).
 *
 * Schéma `bls-unchained-g1-rfc9380` (quicknet) : signature G1, clé publique G2,
 * hash-to-curve RFC 9380 (DST G1 par défaut de `@noble/curves`, qui correspond au
 * schéma drand). Contrôles :
 *  1. `sha256(signature) === randomness` (intégrité) ;
 *  2. `verify(signature, hash(roundToMessage(round)), publicKey)` (BLS).
 */
export function verifyBeacon(
  beacon: DrandBeacon,
  chainInfo: DrandChainInfo = QUICKNET_CHAIN_INFO,
): boolean {
  try {
    const signature = hexToBytes(beacon.signature);
    if (bytesToHex(sha256(signature)) !== beacon.randomness) {
      return false;
    }
    const messagePoint = shortSignatures.hash(roundToMessage(beacon.round));
    return shortSignatures.verify(signature, messagePoint, hexToBytes(chainInfo.publicKey));
  } catch {
    // Signature/clé/point malformés → beacon simplement invalide.
    return false;
  }
}
