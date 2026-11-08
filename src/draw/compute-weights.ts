import type { PoolParticipant } from './pool.js';

/**
 * Plafond du **bonus de parrainage** d'une participation, en entrées : en mode `weighted`, le
 * poids vaut au plus `1 + REFERRAL_BONUS_CAP`, quel que soit le nombre de filleuls.
 *
 * ## Pourquoi un plafond
 *
 * Le parrainage est le seul bonus que la plateforme vérifie, mais sans borne il rendait le poids
 * d'une seule personne illimité face à celui d'un participant honnête : chaque filleul valide —
 * ou chaque participation répétée qui se parrainait elle-même — ajoutait `referralBonusEntries`.
 * Le plafond borne l'avantage que le parrainage peut donner.
 *
 * ## Pourquoi une constante du moteur et pas un réglage
 *
 * Le vérificateur doit rejouer les poids sans rien demander à la plateforme : un plafond lu dans
 * une configuration de déploiement serait invérifiable. Le changer change la règle de tirage, donc
 * exige une nouvelle version d'algorithme (voir `algorithm-version.ts`), jamais une variable
 * d'environnement.
 *
 * Il ne s'applique qu'aux giveaways produits sous {@link REFERRAL_CAP_ALGORITHM_VERSION} ou
 * après ({@link referralBonusCapFor}) : un tirage scellé avant lui se rejoue à l'identique.
 */
export const REFERRAL_BONUS_CAP = 5;

/** Première version d'algorithme qui applique {@link REFERRAL_BONUS_CAP}. */
export const REFERRAL_CAP_ALGORITHM_VERSION = 4;

/**
 * Plafond applicable à un giveaway d'après sa version d'algorithme : {@link REFERRAL_BONUS_CAP}
 * à partir de {@link REFERRAL_CAP_ALGORITHM_VERSION}, `null` (aucun plafond) avant.
 */
export function referralBonusCapFor(algorithmVersion: number): number | null {
  return algorithmVersion >= REFERRAL_CAP_ALGORITHM_VERSION ? REFERRAL_BONUS_CAP : null;
}

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
  /**
   * Plafond du bonus de parrainage d'une participation ({@link referralBonusCapFor}). Absent ou
   * `null` : aucun plafond — la règle des giveaways antérieurs à la version 4.
   */
  referralBonusCap?: number | null;
}

/**
 * Pondération **déterministe** du pool pour le tirage :
 *  - `equal` → poids 1 pour tous ;
 *  - `weighted` → `1 + min(referralBonusCap, referralBonusEntries × nb de filleuls valides)` —
 *    sans plafond (`referralBonusCap` absent) pour les giveaways antérieurs à la version 4 ;
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
    const bonus = input.referralBonusEntries * (referralCount.get(id) ?? 0);
    const cap = input.referralBonusCap ?? null;
    return { id, weight: 1 + (cap === null ? bonus : Math.min(cap, bonus)) };
  });
}
