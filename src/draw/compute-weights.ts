import type { PoolParticipant } from './pool.js';

/** Mode de pondération du pool, figé à la création du giveaway. */
export type WeightingMode = 'equal' | 'weighted';

export interface WeightInputParticipant {
  id: string;
  referredByParticipantId: string | null;
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
 *  - `weighted` → `1 + referralBonusEntries × (nb de filleuls valides du participant)`.
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

  return input.validIds.map((id) => {
    if (input.weightingMode === 'equal') {
      return { id, weight: 1 };
    }
    return { id, weight: 1 + input.referralBonusEntries * (referralCount.get(id) ?? 0) };
  });
}
