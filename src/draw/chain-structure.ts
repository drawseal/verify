/** Ce qui décide de la structure d'une chaîne de désignations : sa chronologie, ses rangs. */
export interface StructuredChainEntry {
  order: number;
  rank: number;
  status: string;
}

/**
 * La chaîne de désignations a-t-elle une structure qu'une attribution honnête peut produire ?
 *
 * La plateforme numérote les désignations dans la chronologie globale (0, 1, 2…), sur les seuls
 * rangs 1..`maxRank`, et ne crée un remplaçant qu'en forfaitant, dans la même transaction, la
 * désignation active du rang. D'où trois exigences :
 *
 *  - chaque `order` est un entier sûr positif ou nul, **unique** ;
 *  - chaque `rank` est un entier dans `[1, maxRank]` ;
 *  - dans un rang, toute désignation suivie d'une autre est forfaitée.
 *
 * Sans l'unicité, le rejeu ne savait pas distinguer une désignation initiale d'un remplaçant :
 * une désignation forgée qui reprenait l'ordre d'une désignation initiale (ou un alias `NaN`,
 * `-0`) était classée initiale et jamais rejouée. Sans la borne des rangs, une désignation hors
 * de `[1, maxRank]` n'était confrontée à aucun calcul, tout en étant affichée comme gagnante.
 *
 * La contiguïté des ordres n'est pas exigée : seule leur succession gouverne le rejeu.
 */
export function chainWellFormed(
  entries: readonly StructuredChainEntry[],
  maxRank: number,
): boolean {
  const orders = new Set<number>();
  for (const e of entries) {
    // `Set` compare en SameValueZero : `0` et `-0` y sont un seul ordre, ce qu'on veut ici.
    if (!Number.isSafeInteger(e.order) || e.order < 0 || orders.has(e.order)) {
      return false;
    }
    orders.add(e.order);
    if (!Number.isSafeInteger(e.rank) || e.rank < 1 || e.rank > maxRank) {
      return false;
    }
  }
  const lastStatusByRank = new Map<number, string>();
  for (const e of [...entries].sort((a, b) => a.order - b.order)) {
    const previous = lastStatusByRank.get(e.rank);
    if (previous !== undefined && previous !== 'forfeited') {
      return false;
    }
    lastStatusByRank.set(e.rank, e.status);
  }
  return true;
}
