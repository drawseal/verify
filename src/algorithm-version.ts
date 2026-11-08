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
 *
 * ## Historique
 *
 * - **1** — tirage programmé : cascade multi-lots, pondération par entrées, sceau de Merkle.
 * - **2** — ajout de l'**instant gagnant** (`instant/instant-win.ts`). Un vérificateur v1 ne
 *   sait pas rejouer ce type de tirage : il refusera donc de conclure sur un document qui
 *   déclare la version 2, ce qui est le comportement voulu. Les tirages programmés, eux,
 *   continuent de déclarer la version **1** — leur règle n'a pas bougé d'une ligne, et un
 *   vérificateur ancien doit pouvoir les vérifier pour toujours.
 * - **3** — ajout du **tirage de rattrapage** de l'instant gagnant
 *   (`instant/instant-catchup.ts`), et du rattachement vérifiable des positions gagnantes à leurs
 *   gagnants (`instant/instant-designations.ts`). Un vérificateur v2 recalcule bien les positions,
 *   mais ignore qu'un rang laissé vacant a pu être pourvu par un second tirage, sur un second
 *   round drand : il conclurait « non conforme » sur un rattrapage honnête. Il refuse donc de
 *   conclure, ce qui est le comportement voulu.
 *
 *   Seuls les instants gagnants **qui activent le rattrapage** déclarent la 3 ; les autres restent
 *   en 2, et les tirages programmés en 1. Une version ne se propage jamais à des documents dont la
 *   règle n'a pas changé.
 * - **4** — **plafond du bonus de parrainage** (`REFERRAL_BONUS_CAP`, +5 entrées par
 *   participation, `draw/compute-weights.ts`). Un vérificateur v3 recalculerait sans plafond les
 *   poids des pools réduits (re-tirage, rattrapage) et conclurait « non conforme » sur un tirage
 *   honnête : il refuse donc de conclure, ce qui est le comportement voulu.
 *
 *   Seuls les giveaways en pondération `weighted` créés depuis déclarent la 4 — les seuls où le
 *   plafond peut jouer. Les autres gardent leur version, et les giveaways `weighted` antérieurs
 *   gardent la leur et leurs poids sans plafond : leurs sceaux se rejouent à l'identique.
 *
 *   L'exclusion de l'**auto-parrainage** (une personne — même adresse, alias compris — ne compte
 *   jamais comme son propre filleul, et seule sa première participation valide peut compter comme
 *   filleul) n'est PAS une règle de ce moteur : elle s'applique au graphe de parrainage avant le
 *   scellement, côté plateforme, et le graphe publié est déjà celui qui a servi. Le vérificateur
 *   n'a rien de plus à savoir pour la rejouer.
 */
export const ALGORITHM_VERSION = 4;

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
