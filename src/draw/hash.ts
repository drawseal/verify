import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * SHA-256 d'une chaîne UTF-8, rendu en hexadécimal minuscule (64 caractères).
 *
 * Seul point d'appel de `@noble/hashes` dans le moteur : implémentation
 * **synchrone** et **isomorphe** (Node + navigateur), pour garder le cœur pur.
 * `node:crypto` (absent du navigateur) et Web Crypto (asynchrone, contaminant)
 * sont écartés (cf. spec §2).
 */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}
