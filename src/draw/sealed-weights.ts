import {
  computeWeights,
  type WeightInputParticipant,
  type WeightingMode,
} from './compute-weights.js';
import type { PoolParticipant } from './pool.js';

/**
 * Les entrées non scellées (`weightingMode`, `referrals`, `referralBonusEntries`, plafond) reproduisent-elles
 * **exactement** les poids scellés ?
 *
 * ## Pourquoi
 *
 * Seule la feuille de Merkle (`id:poids`) est couverte par un engagement. Tout rejeu qui
 * recalcule des poids — re-tirage d'un tirage à date, rattrapage ou remplacement d'un instant
 * gagnant — les tire de ces trois champs, qu'aucun engagement ne couvre. Sans cette égalité, un
 * document gardait l'engagement, la graine, le beacon et le sceau d'un tirage honnête, réécrivait
 * ces champs pour qu'un autre participant gagne, et passait tous les contrôles.
 *
 * ## Les deux conditions
 *
 * D'abord `referrals` porte une ligne et une seule par participant scellé, et aucune autre : une
 * ligne dupliquée compterait deux fois le même filleul, et une ligne en trop ou en moins décrirait
 * un autre pool — dans les deux cas, les poids pleins pourraient coïncider tandis que ceux d'un
 * pool réduit divergeraient. Ensuite les poids recalculés sur les ids scellés égalent, id pour id,
 * ceux des feuilles.
 *
 * ## Ce que cette égalité ne couvre PAS
 *
 * En `weighted`, deux graphes de parrainage qui donnent les mêmes poids pleins (mêmes nombres de
 * filleuls par parrain, arêtes permutées) ne donnent pas forcément les mêmes poids une fois des
 * désignés retirés ; de même un document qui annoncerait `supplied` avec les poids pleins d'un
 * tirage `weighted`. Le graphe et le mode n'entrent pas dans la feuille de Merkle : les lier aux
 * pools réduits exige de les sceller, ce qui est une évolution du format du sceau.
 */
export function referralsReproduceSealedWeights(
  sealed: readonly PoolParticipant[],
  weightingMode: WeightingMode,
  referrals: readonly WeightInputParticipant[],
  referralBonusEntries: number,
  /** Plafond du bonus de parrainage du document (`null` avant la version 4). */
  referralBonusCap: number | null = null,
): boolean {
  const sealedIds = sealed.map((p) => p.id);
  const referralIds = new Set(referrals.map((r) => r.id));
  if (
    referrals.length !== sealed.length ||
    referralIds.size !== referrals.length ||
    !sealedIds.every((id) => referralIds.has(id))
  ) {
    return false;
  }
  const rebuilt = computeWeights({
    weightingMode,
    validIds: sealedIds,
    participants: [...referrals],
    referralBonusEntries,
    referralBonusCap,
  });
  return rebuilt.every((w, i) => w.weight === sealed[i].weight);
}

/**
 * Repli neutre d'un document qui ne publie pas `referrals` : chaque participant scellé pèse 1.
 *
 * Il n'invente rien quand il reproduit les poids scellés — à confronter, donc, avec
 * {@link referralsReproduceSealedWeights} avant tout usage.
 */
export function neutralReferrals(sealed: readonly PoolParticipant[]): WeightInputParticipant[] {
  return sealed.map((p) => ({ id: p.id, referredByParticipantId: null, suppliedEntries: 1 }));
}
