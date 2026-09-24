import type { PoolParticipant } from './pool.js';

/** Mode de pondération du pool, figé à la création du giveaway. */
export type WeightingMode = 'equal' | 'weighted' | 'supplied';

export interface WeightInputParticipant {
  id: string;
  referredByParticipantId: string | null;
  /**
   * Entrées apportées par l'organisateur (mode `supplied`), entier ≥ 1.
   *
   * La plateforme n'observe pas cette quantité, elle la reçoit : c'est un nombre de billets
   * vendus hors ligne. Elle entre telle quelle dans la feuille scellée, donc un participant
   * peut vérifier son propre compte avant le tirage — c'est tout l'intérêt.
   */
  suppliedEntries: number;
}

export interface ComputeWeightsInput {
  weightingMode: WeightingMode;
  /** Ids **valides** (après anti-fraude), triés/quelconques. */
  validIds: string[];
  /** Tous les participants valides (pour compter les filleuls confirmés & valides). */
  participants: WeightInputParticipant[];
  /** Entrées bonus accordées par filleul confirmé & valide (0 si pas d'action referral). */
  referralBonusEntries: number;
}

/**
 * Pondération **déterministe** du pool pour le tirage :
 *  - `equal` → poids 1 pour tous ;
 *  - `weighted` → `1 + referralBonusEntries × (nb de filleuls valides du participant)` ;
 *  - `supplied` → le nombre d'entrées porté par le participant (`suppliedEntries`), sans
 *    parrainage : les entrées sont fournies par l'organisateur, pas construites par la plateforme.
 *
 * Seuls les filleuls **valides** (présents dans `validIds`, donc confirmés et non
 * exclus par l'anti-fraude) comptent → le parrainage est le seul bonus vérifiable
 * (§6). Poids entier ≥ 1, conforme à `PoolParticipant`.
 */
export function computeWeights(input: ComputeWeightsInput): PoolParticipant[] {
  const valid = new Set(input.validIds);

  const referralCount = new Map<string, number>();
  if (input.weightingMode === 'weighted') {
    for (const p of input.participants) {
      if (!valid.has(p.id)) {
        continue;
      }
      const sponsor = p.referredByParticipantId;
      if (sponsor && valid.has(sponsor)) {
        referralCount.set(sponsor, (referralCount.get(sponsor) ?? 0) + 1);
      }
    }
  }

  const suppliedById = new Map<string, number>();
  if (input.weightingMode === 'supplied') {
    for (const p of input.participants) {
      suppliedById.set(p.id, p.suppliedEntries);
    }
  }

  return input.validIds.map((id) => {
    if (input.weightingMode === 'equal') {
      return { id, weight: 1 };
    }
    if (input.weightingMode === 'supplied') {
      return { id, weight: suppliedById.get(id) ?? 1 };
    }
    return { id, weight: 1 + input.referralBonusEntries * (referralCount.get(id) ?? 0) };
  });
}
