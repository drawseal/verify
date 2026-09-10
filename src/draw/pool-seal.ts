import { canonicalize, type PoolParticipant } from './pool.js';
import { hashLeaf, merkleProof, merkleRoot, verifyMerkleProof } from './merkle.js';
import type { MerkleProofStep } from './merkle.js';
import { DrawEngineError } from './errors.js';

/**
 * Scellement de la liste des participants — la pièce qui rend un tirage démontrable.
 *
 * ## Ce que le sceau établit
 *
 * L'engagement publié à la programmation fige déjà la graine (`sha256(serverSeed)`) et **quel**
 * hasard sera employé (un numéro de round drand encore à venir). Il reste une troisième entrée au
 * calcul : la liste des participants. Tant qu'elle peut bouger, les deux premiers engagements ne
 * garantissent rien — ajouter ou retirer une entrée après avoir vu le tirage sortir suffirait à
 * changer le gagnant sans contredire aucune empreinte publiée.
 *
 * Le sceau ferme cette porte. À la fermeture des inscriptions, la liste est réduite à une racine de
 * Merkle publiée immédiatement, **avant** que le round drand employé n'existe. À partir de là :
 *
 * - la liste ne peut plus changer sans que la racine cesse de correspondre ;
 * - le hasard n'était pas connaissable au moment où la liste a été figée ;
 * - le résultat est donc déjà déterminé, et personne — pas même celui qui détient la graine et la
 *   base de données — ne peut savoir lequel.
 *
 * ## L'invariant d'ordre
 *
 * La deuxième affirmation n'est pas une promesse, c'est une comparaison d'entiers :
 * `sealRound < drandRound`. Le round employé appartient à une fenêtre temporelle qui n'était pas
 * encore ouverte quand la liste a été scellée. N'importe qui peut refaire ce contrôle avec les
 * seules valeurs publiées.
 */

/**
 * Sceau publiable d'une liste de participants. Ne contient **aucune** donnée personnelle : les
 * feuilles ne portent que des identifiants pseudonymes et des poids.
 */
export interface PoolSeal {
  /** Racine de l'arbre de Merkle des entrées canoniques. */
  merkleRoot: string;
  /**
   * Nombre d'entrées scellées.
   *
   * Publiée à côté de la racine, et vérifiée : une racine seule ne dit rien du nombre de feuilles,
   * et la sceller ferme la classe d'ambiguïtés propres aux arbres déséquilibrés.
   */
  poolSize: number;
}

/** Entrée canonique d'un participant, telle que hachée en feuille. */
export function canonicalEntry(participant: PoolParticipant): string {
  return `${participant.id}:${participant.weight}`;
}

/**
 * Feuilles du pool, dans l'ordre canonique (tri binaire par identifiant).
 *
 * Le tri est ce qui rend la racine indépendante de l'ordre d'insertion en base : deux exports de la
 * même liste, dans n'importe quel ordre, donnent le même sceau. Sans lui, la racine dépendrait d'un
 * détail de requête SQL, et une vérification honnête pourrait échouer.
 */
export function poolLeaves(pool: PoolParticipant[]): string[] {
  return canonicalize(pool).map((p) => hashLeaf(canonicalEntry(p)));
}

/** Calcule le sceau d'un pool. Lève sur un pool vide : il n'y a rien à sceller. */
export function computePoolSeal(pool: PoolParticipant[]): PoolSeal {
  if (pool.length === 0) {
    throw new DrawEngineError('pool vide : aucun sceau à calculer');
  }
  return { merkleRoot: merkleRoot(poolLeaves(pool)), poolSize: pool.length };
}

/**
 * Le pool révélé correspond-il au sceau publié ?
 *
 * Compare la taille **et** la racine. La taille est contrôlée d'abord parce que c'est l'écart le
 * plus probable et le plus parlant (une entrée ajoutée ou retirée), et parce que comparer une
 * racine recalculée sur un pool vide n'aurait pas de sens.
 *
 * Ne lève pas : un écart est un résultat à afficher, pas une erreur de programmation.
 */
export function poolMatchesSeal(pool: PoolParticipant[], seal: PoolSeal): boolean {
  if (pool.length !== seal.poolSize || pool.length === 0) {
    return false;
  }
  return merkleRoot(poolLeaves(pool)) === seal.merkleRoot;
}

/**
 * La liste a-t-elle été scellée **avant** que le hasard employé soit connaissable ?
 *
 * Strictement inférieur, et non « inférieur ou égal » : un scellement dans la même fenêtre de round
 * que le tirage laisserait planer le doute qu'il ait eu lieu après la publication du beacon. C'est
 * la seule comparaison qui garantit l'antériorité, et elle ne coûte rien.
 */
export function sealPrecedesRandomness(sealRound: number, drandRound: number): boolean {
  if (!Number.isInteger(sealRound) || !Number.isInteger(drandRound)) {
    return false;
  }
  return sealRound < drandRound;
}

/**
 * Preuve d'inclusion d'un participant dans le pool scellé, à remettre à ce participant.
 *
 * C'est ce qui lui permet de vérifier lui-même que son entrée comptait, sans télécharger la liste
 * entière et sans avoir à croire la plateforme sur parole. Lève si l'identifiant n'est pas dans le
 * pool : il n'y a pas de preuve à produire, et en fabriquer une serait exactement ce que ce
 * mécanisme est censé rendre impossible.
 */
export function poolInclusionProof(
  pool: PoolParticipant[],
  participantId: string,
): { leaf: string; proof: MerkleProofStep[] } {
  const canonical = canonicalize(pool);
  const index = canonical.findIndex((p) => p.id === participantId);
  if (index === -1) {
    throw new DrawEngineError(`participant absent du pool : "${participantId}"`);
  }
  const leaves = canonical.map((p) => hashLeaf(canonicalEntry(p)));
  return { leaf: leaves[index] as string, proof: merkleProof(leaves, index) };
}

/**
 * Vérifie une preuve d'inclusion contre un sceau publié. Rend un booléen — côté participant, un
 * échec est une information, pas un plantage.
 */
export function verifyPoolInclusion(
  participant: PoolParticipant,
  proof: MerkleProofStep[],
  seal: PoolSeal,
): boolean {
  return verifyMerkleProof(hashLeaf(canonicalEntry(participant)), proof, seal.merkleRoot);
}
