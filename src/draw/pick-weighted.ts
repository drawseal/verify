import { assertValidPool, canonicalize } from './pool.js';
import { DrawEngineError } from './errors.js';
import type { PoolParticipant } from './pool.js';

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Sélectionne un participant de façon **déterministe** à partir d'un `finalHash`.
 *
 * Algorithme (spec §4.4) :
 *  1. valide le pool, puis le trie en ordre canonique ;
 *  2. `total = Σ weight` ; `target = BigInt('0x' + finalHash) % total` ;
 *  3. parcourt les poids cumulés → participant dont l'intervalle
 *     `[cumStart, cumStart + weight)` contient `target`.
 *
 * Le biais modulo est négligeable : avec un hash 256 bits, il est borné par
 * `total / 2²⁵⁶`. Même `finalHash` → toujours le même participant (rejouable).
 */
export function pickWeighted(pool: PoolParticipant[], finalHash: string): PoolParticipant {
  assertValidPool(pool);
  if (!HEX_RE.test(finalHash)) {
    throw new DrawEngineError('finalHash invalide : chaîne hexadécimale attendue');
  }

  const canonical = canonicalize(pool);
  // Somme en BigInt de bout en bout : un cumul en Number perdrait de la précision au-delà de
  // 2⁵³ et pourrait décaler l'intervalle sélectionné — le gagnant doit être exact, pas probable.
  const total = canonical.reduce((sum, p) => sum + BigInt(p.weight), 0n);
  const target = BigInt('0x' + finalHash) % total;

  let cumulative = 0n;
  for (const participant of canonical) {
    cumulative += BigInt(participant.weight);
    if (target < cumulative) {
      return participant;
    }
  }

  // Inatteignable : target ∈ [0, total) et Σ weight = total.
  /* c8 ignore next */
  throw new DrawEngineError('sélection impossible : cible hors des intervalles cumulés');
}
