/**
 * Version de l'**algorithme de tirage**, distincte de la version du paquet.
 *
 * ## Pourquoi elle existe
 *
 * Un vérificateur publié qui prend du retard sur le moteur est **pire que pas de vérificateur
 * du tout** : confronté à un tirage produit par une règle qu'il ne connaît pas, il recalcule un
 * gagnant différent et conclut « non conforme ». Il fabrique alors une accusation de fraude
 * contre un tirage honnête, avec notre propre code à l'appui — et nous n'aurions rien à lui
 * opposer, puisque c'est nous qui l'aurions publié.
 *
 * D'où cette règle, qui est la seule réponse correcte : **face à un document produit par une
 * version d'algorithme postérieure à la sienne, le vérificateur refuse de conclure.** Il ne dit
 * ni « conforme » ni « non conforme » : il dit qu'il est trop ancien et nomme la version qu'il
 * lui faudrait. Un « je ne sais pas » explicite est un résultat honnête ; un « non conforme »
 * calculé avec la mauvaise règle est un mensonge.
 *
 * ## Quand l'incrémenter
 *
 * Dès que le résultat d'un tirage cesse d'être reproductible par la version précédente : ordre
 * de dérivation des graines, formule de pondération, forme de l'arbre de Merkle, choix du round
 * drand, règle de cascade ou de re-tirage. Un renommage, un commentaire ou un test n'y touchent
 * pas.
 *
 * Une pipeline le vérifie mécaniquement (`.gitlab-ci.yml`, job `verify_algorithm_lock`) : toute
 * modification de `packages/verify/src/**` sans mouvement de cette constante rend la pipeline
 * rouge. La barrière est là parce que l'oubli est silencieux et que sa conséquence est une
 * fausse accusation.
 */
export const ALGORITHM_VERSION = 1;

/** Verdict rendu avant toute vérification : peut-on seulement conclure sur ce document ? */
export type AlgorithmVersionVerdict =
  | { canVerify: true }
  | {
      canVerify: false;
      /** Version annoncée par le document. */
      declared: number;
      /** Version que ce vérificateur sait rejouer. */
      supported: number;
      reason: 'verifier-too-old';
    };

/**
 * Décide si ce vérificateur peut se prononcer sur un document.
 *
 * Une version **antérieure** ne pose aucun problème : les règles passées restent rejouables, un
 * tirage ancien doit rester vérifiable pour toujours. Seule une version **postérieure** arrête
 * tout — c'est le cas « le vérificateur est en retard », le seul qui produirait une fausse
 * accusation.
 */
export function checkAlgorithmVersion(declared: number): AlgorithmVersionVerdict {
  if (declared > ALGORITHM_VERSION) {
    return {
      canVerify: false,
      declared,
      supported: ALGORITHM_VERSION,
      reason: 'verifier-too-old',
    };
  }
  return { canVerify: true };
}
