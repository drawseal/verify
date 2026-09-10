import { sha256Hex } from './hash.js';
import { DrawEngineError } from './errors.js';

/**
 * Arbre de Merkle sur la liste des participants d'un tirage.
 *
 * ## Ce que l'arbre apporte, qu'un hash plat ne donne pas
 *
 * Une empreinte plate de la liste concaténée prouve qu'*une* liste n'a pas bougé, à condition de
 * republier la liste entière pour la recalculer. L'arbre y ajoute la **preuve d'inclusion
 * individuelle** : un participant vérifie que son identifiant figurait dans la liste scellée en
 * recalculant une poignée d'empreintes — son chemin jusqu'à la racine — sans télécharger les
 * centaines de milliers d'autres entrées.
 *
 * C'est ce qui remplace « votre inscription comptait, croyez-nous » par un contrôle que le
 * participant fait lui-même, dans son navigateur, en quelques millisecondes.
 *
 * ## Trois décisions de construction, trois attaques fermées
 *
 * 1. **Préfixes de domaine distincts** (`leaf:` et `node:`). Sans eux, l'empreinte d'un nœud
 *    interne pourrait être présentée comme une feuille, et une preuve d'inclusion serait
 *    fabricable pour un participant absent de la liste. C'est l'attaque par confusion
 *    feuille/nœud, et le préfixe la rend structurellement impossible : les deux fonctions de
 *    hachage n'ont pas la même image.
 * 2. **Un niveau impair promeut son dernier nœud tel quel**, sans le dupliquer. Dupliquer le
 *    dernier élément — le choix historique de Bitcoin — permet à deux listes différentes de
 *    produire la même racine. On remonte donc le nœud orphelin inchangé.
 * 3. **La taille de la liste est scellée à côté de la racine** (voir `pool-seal.ts`). Une racine
 *    seule ne dit rien du nombre de feuilles ; publier la taille ferme définitivement la classe
 *    d'ambiguïtés liées aux arbres déséquilibrés.
 */

/** Préfixe de domaine des feuilles. Ne jamais partager avec celui des nœuds. */
const LEAF_PREFIX = 'leaf:';

/** Préfixe de domaine des nœuds internes. */
const NODE_PREFIX = 'node:';

/**
 * Une étape du chemin de vérification : l'empreinte sœur et le côté où elle se trouve.
 *
 * Le côté est indispensable : `hash(a || b)` diffère de `hash(b || a)`, donc une preuve sans
 * orientation serait invérifiable — ou, pire, vérifiable dans le mauvais ordre.
 */
export interface MerkleProofStep {
  /** Empreinte du nœud frère à ce niveau. */
  sibling: string;
  /** Position du frère par rapport au nœud courant. */
  position: 'left' | 'right';
}

/** Empreinte d'une feuille, à partir de son contenu canonique (`id:weight`). */
export function hashLeaf(canonicalEntry: string): string {
  return sha256Hex(`${LEAF_PREFIX}${canonicalEntry}`);
}

/** Empreinte d'un nœud interne, à partir de ses deux enfants (ordre significatif). */
export function hashNode(left: string, right: string): string {
  return sha256Hex(`${NODE_PREFIX}${left}${right}`);
}

/**
 * Racine de l'arbre construit sur `leaves` (empreintes de feuilles, dans l'ordre canonique).
 *
 * Une liste vide lève : un tirage sans participant n'a pas de sceau à publier, et renvoyer une
 * racine conventionnelle pour ce cas ferait passer une liste vide pour une liste scellée.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    throw new DrawEngineError('arbre de Merkle vide : au moins une feuille est requise');
  }
  let level = leaves;
  while (level.length > 1) {
    level = nextLevel(level);
  }
  return level[0] as string;
}

/**
 * Chemin de vérification de la feuille d'index `index`, de bas en haut.
 *
 * L'ordre des étapes est celui de la remontée : `verifyMerkleProof` les applique dans cet ordre.
 * Une racine à feuille unique donne une preuve vide, ce qui est correct — il n'y a rien à
 * recombiner, la feuille *est* la racine.
 */
export function merkleProof(leaves: string[], index: number): MerkleProofStep[] {
  if (leaves.length === 0) {
    throw new DrawEngineError('arbre de Merkle vide : au moins une feuille est requise');
  }
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new DrawEngineError(
      `index de feuille hors bornes : ${index} (${leaves.length} feuille(s))`,
    );
  }

  const steps: MerkleProofStep[] = [];
  let level = leaves;
  let position = index;

  while (level.length > 1) {
    const isRightChild = position % 2 === 1;
    const siblingIndex = isRightChild ? position - 1 : position + 1;
    // Dernier nœud d'un niveau impair : il est promu seul, il n'a pas de frère à ce niveau.
    if (siblingIndex < level.length) {
      steps.push({
        sibling: level[siblingIndex] as string,
        position: isRightChild ? 'left' : 'right',
      });
    }
    level = nextLevel(level);
    position = Math.floor(position / 2);
  }
  return steps;
}

/**
 * Recalcule une racine à partir d'une feuille et de son chemin, et la compare à `expectedRoot`.
 *
 * Ne lève pas : une preuve invalide est un **résultat** à afficher au participant, pas une erreur
 * de programmation. Une étape dont le `position` est inattendu est traitée comme invalide plutôt
 * qu'interprétée au mieux — deviner l'intention d'une preuve malformée reviendrait à l'accepter.
 */
export function verifyMerkleProof(
  leaf: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): boolean {
  let current = leaf;
  for (const step of proof) {
    if (step.position === 'left') {
      current = hashNode(step.sibling, current);
    } else if (step.position === 'right') {
      current = hashNode(current, step.sibling);
    } else {
      return false;
    }
  }
  return current === expectedRoot;
}

/** Un niveau vers le haut : les nœuds sont appairés, un dernier nœud orphelin est promu tel quel. */
function nextLevel(level: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i] as string;
    const right = level[i + 1];
    next.push(right === undefined ? left : hashNode(left, right));
  }
  return next;
}
