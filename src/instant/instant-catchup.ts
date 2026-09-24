import {
  computeWeights,
  type WeightInputParticipant,
  type WeightingMode,
} from '../draw/compute-weights.js';
import { computeWinners } from '../draw/compute-winners.js';

/**
 * Le **tirage de rattrapage** d'un instant gagnant, et sa vérification.
 *
 * ## Ce qu'il remet en jeu
 *
 * Les rangs restés sans gagnant : une position gagnante que personne n'a atteinte, ou dont le
 * porteur ne remplissait pas les conditions de remise. Sans rattrapage, ces lots ne sont pas
 * attribués — ce qui est honnête, et démontré par les positions publiées. Avec, ils sont tirés
 * parmi les participations qui n'ont rien gagné.
 *
 * ## Pourquoi un second round drand
 *
 * Celui de l'ouverture est émis **avant** la fermeture des inscriptions, donc avant le scellement
 * du pool. S'en servir ici violerait l'antériorité que tout le produit tient : on ne pourrait rien
 * opposer à qui soutiendrait que la liste a été ajustée une fois le hasard connu. Le rattrapage
 * s'appuie donc sur un round engagé à la programmation et émis **après** le scellement.
 *
 * ## Pourquoi l'ordre des rangs gouverne
 *
 * Les rangs vacants sont servis dans l'ordre croissant, et chaque désignation exclut les
 * précédentes. Sans cet ordre, deux rangs vacants pourraient recevoir la même personne selon
 * l'ordre d'évaluation — et le rejeu ne serait plus reproductible.
 */

export interface InstantCatchupInput {
  /** Graine révélée à la clôture, la même que celle de l'engagement. */
  serverSeed: string;
  /** Valeur drand du round de rattrapage — **pas** celle de l'ouverture. */
  catchupDrandValue: string;
  weightingMode: WeightingMode;
  /** Ids valides retenus au scellement, dans l'ordre scellé. */
  sealedValidIds: readonly string[];
  /** Graphe de parrainage des participants valides — nécessaire pour recalculer les poids. */
  referrals: readonly WeightInputParticipant[];
  referralBonusEntries: number;
  /** Participations déjà gagnantes, tous rangs confondus : elles ne peuvent pas regagner. */
  alreadyWinningIds: readonly string[];
  /** Rangs à pourvoir, dans n'importe quel ordre : ils sont triés ici. */
  vacantRanks: readonly number[];
}

export interface InstantCatchupWinner {
  rank: number;
  participantId: string;
}

export interface InstantCatchupResult {
  winners: InstantCatchupWinner[];
  /**
   * Rangs restés vacants **malgré** le rattrapage : il n'y avait plus assez de participations
   * n'ayant rien gagné. Un fait publié, pas une omission.
   */
  stillVacantRanks: number[];
}

/**
 * Calcule le rattrapage. Fonction **pure** : un tiers la rejoue à partir des seules données
 * publiées, sans rien demander à personne.
 */
export function instantCatchup(input: InstantCatchupInput): InstantCatchupResult {
  const rangs = [...input.vacantRanks].sort((a, b) => a - b);
  const exclus = new Set(input.alreadyWinningIds);
  const winners: InstantCatchupWinner[] = [];
  const stillVacantRanks: number[] = [];

  for (const rank of rangs) {
    const restants = input.sealedValidIds.filter((id) => !exclus.has(id));
    if (restants.length === 0) {
      stillVacantRanks.push(rank);
      continue;
    }
    /*
     * Les poids sont recalculés à CHAQUE rang, et non calculés une fois puis amputés. En mode
     * pondéré, retirer un participant retire un filleul valide à son parrain, dont le poids
     * baisse : une soustraction naïve donnerait un autre gagnant, et le rejeu échouerait sur un
     * rattrapage pourtant honnête. Même piège que pour les re-tirages de forfait.
     */
    const pool = computeWeights({
      weightingMode: input.weightingMode,
      validIds: restants,
      participants: [...input.referrals],
      referralBonusEntries: input.referralBonusEntries,
    });
    /*
     * Un seul gagnant par appel, et le rang entre dans la graine via `winnersCount` : sans cela,
     * deux rangs vacants tireraient la même personne. C'est l'exclusion cumulative qui les
     * sépare, exactement comme la cascade sépare ses propres rangs.
     */
    const [gagnant] = computeWinners({
      serverSeed: input.serverSeed,
      drandValue: input.catchupDrandValue,
      winnersCount: 1,
      participants: pool,
    }).winners;
    winners.push({ rank, participantId: gagnant.participantId });
    exclus.add(gagnant.participantId);
  }

  return { winners, stillVacantRanks };
}
