import { sha256Hex } from './hash.js';
import { DrawEngineError } from './errors.js';

/**
 * Un participant vu par le moteur : pseudonyme stable (`participantId`) + poids
 * entier ≥ 1. **Jamais l'email** — l'empreinte et les résultats sont publiables
 * sans fuite RGPD.
 */
export interface PoolParticipant {
  /** Pseudonyme stable (participantId). JAMAIS l'email. */
  id: string;
  /** Nombre d'entrées (mode weighted) ou 1 (mode equal). Entier ≥ 1. */
  weight: number;
}

/**
 * Copie triée par `id` croissant (comparaison binaire, indépendante de la
 * locale → reproductible partout). L'ordre d'entrée n'influe sur aucun calcul.
 */
export function canonicalize(pool: PoolParticipant[]): PoolParticipant[] {
  return [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Empreinte de la liste **complète** des participants figée au moment du tirage.
 * Ne dépend que de `(id, weight)` triés → un client la reconstruit à partir des
 * seules données publiques révélées, sans email. Séparateurs explicites (`:`,
 * `\n`) pour éviter toute collision de concaténation.
 */
export function computeFingerprint(pool: PoolParticipant[]): string {
  const canonical = canonicalize(pool);
  return sha256Hex(canonical.map((p) => `${p.id}:${p.weight}`).join('\n'));
}

/**
 * Valide un pool avant tout calcul. Lève `DrawEngineError` sur : pool vide,
 * poids non entier ou ≤ 0, ou `id` dupliqués. Une entrée malformée est une
 * erreur de programmation, pas un écart auditable.
 */
export function assertValidPool(pool: PoolParticipant[]): void {
  if (pool.length === 0) {
    throw new DrawEngineError('pool vide : au moins un participant est requis');
  }
  const seen = new Set<string>();
  for (const p of pool) {
    if (!Number.isInteger(p.weight) || p.weight <= 0) {
      throw new DrawEngineError(
        `poids invalide pour "${p.id}" : un entier ≥ 1 est attendu (reçu ${p.weight})`,
      );
    }
    if (seen.has(p.id)) {
      throw new DrawEngineError(`id dupliqué dans le pool : "${p.id}"`);
    }
    seen.add(p.id);
  }
}
