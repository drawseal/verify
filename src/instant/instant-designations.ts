import { instantWinningPositions } from './instant-win.js';

/**
 * Rattacher les positions gagnantes d'un instant gagnant à leurs gagnants, et le **démontrer**.
 *
 * ## Ce que ce module ajoute à `instant-win`
 *
 * `instantWinningPositions` rend l'ensemble gagnant. C'est la moitié du travail : chacun peut
 * alors vérifier **son propre** verdict, puisqu'il connaît son numéro d'ordre. Personne ne pouvait
 * vérifier celui des autres — le lien position → participation n'était publié nulle part, donc
 * l'affirmation « cette personne a gagné le lot 1 » restait à croire sur parole.
 *
 * Ici, ce lien est rejoué : à partir des numéros d'ordre publiés à la clôture, on recalcule qui
 * devait gagner quel lot, et on le compare à ce qui a été annoncé.
 *
 * ## La règle de rattachement
 *
 * Les positions sont rendues **triées**. La plus petite gagne le lot de rang 1, la suivante le
 * rang 2, et ainsi de suite. Déterministe, sans donnée supplémentaire : un vérificateur la
 * reconstitue à partir des seules positions qu'il recalcule.
 *
 * ## Les rangs sans gagnant
 *
 * Un rang reste vacant quand personne n'a atteint sa position — parce qu'elle dépassait le nombre
 * de participations — ou quand son porteur ne remplissait pas les conditions de remise. Le
 * vérificateur les distingue et les rend : ce sont eux que le tirage de rattrapage remet en jeu.
 */

/** Un numéro d'ordre tel que publié à la clôture, rattaché à sa participation. */
export interface EntryPosition {
  id: string;
  position: number;
}

export interface InstantDesignationsInput {
  /** Graine révélée à la clôture. */
  serverSeed: string;
  /** Valeur drand publiée à l'ouverture — celle qui décide des positions. */
  drandValue: string;
  maxEntries: number;
  prizesCount: number;
  /** Numéros d'ordre publiés à la clôture, un par participation. */
  entryPositions: readonly EntryPosition[];
  /**
   * Participations **éligibles à la remise** : adresse confirmée et non écartée par l'anti-fraude.
   * Ce sont les identifiants du pool scellé, publiés eux aussi.
   *
   * Une position gagnante tenue par une participation absente de cet ensemble laisse son rang
   * vacant — c'est la condition de remise annoncée au règlement, pas une décision.
   */
  eligibleIds: readonly string[];
}

export interface InstantDesignation {
  rank: number;
  position: number;
  /** Participation qui tenait cette position **et** remplissait les conditions. `null` sinon. */
  participantId: string | null;
}

export interface InstantDesignationsResult {
  /** Les positions gagnantes recalculées, triées. */
  positions: number[];
  /** Un élément par lot, dans l'ordre des rangs. */
  designations: InstantDesignation[];
  /** Rangs restés sans gagnant — ceux qu'un tirage de rattrapage remet en jeu. */
  vacantRanks: number[];
}

/**
 * Recalcule qui devait gagner quel lot.
 *
 * Fonction **pure** : elle ne lit que ce qui est publié. C'est ce qui permet à un tiers de refaire
 * le calcul sans rien demander à personne.
 */
export function instantDesignations(input: InstantDesignationsInput): InstantDesignationsResult {
  const positions = instantWinningPositions(
    input.serverSeed,
    input.drandValue,
    input.maxEntries,
    input.prizesCount,
  );

  const parPosition = new Map(input.entryPositions.map((e) => [e.position, e.id]));
  const eligibles = new Set(input.eligibleIds);

  const designations = positions.map((position, index) => {
    const id = parPosition.get(position);
    return {
      rank: index + 1,
      position,
      participantId: id !== undefined && eligibles.has(id) ? id : null,
    };
  });

  return {
    positions,
    designations,
    vacantRanks: designations.filter((d) => d.participantId === null).map((d) => d.rank),
  };
}
