/** Un gagnant tel que la page l'affiche : un rang, une participation. */
export interface RankedWinner {
  rank: number;
  participantId: string;
}

/** Une désignation de la chaîne, réduite à ce qui décide de son caractère actif. */
export interface ChainEntry extends RankedWinner {
  status: string;
}

/**
 * Les gagnants annoncés sont-ils **exactement** les désignations actives de la chaîne vérifiée ?
 *
 * Une désignation est active tant qu'elle n'est pas forfaitée — la définition même qu'emploie la
 * plateforme pour publier ses gagnants (`winner_verification_status <> 'forfeited'`). Sans cette
 * égalité, le verdict rejouait la chaîne tandis que la page affichait une autre liste : un badge
 * « vérifié » pouvait côtoyer un gagnant que rien n'avait désigné.
 *
 * Comparaison en multiensemble, indépendante de l'ordre : même nombre d'entrées, et chaque couple
 * (rang, participation) annoncé apparaît autant de fois dans la chaîne active.
 */
export function activeWinnersMatch(
  chain: readonly ChainEntry[],
  claimed: readonly RankedWinner[],
): boolean {
  const key = (w: RankedWinner) => `${w.rank}\u0000${w.participantId}`;
  const active = chain
    .filter((d) => d.status !== 'forfeited')
    .map(key)
    .sort();
  const announced = claimed.map(key).sort();
  return active.length === announced.length && active.every((k, i) => k === announced[i]);
}
