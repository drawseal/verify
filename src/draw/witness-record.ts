import { sha256Hex } from './hash.js';

/**
 * Charge canonique publiée auprès des témoins externes.
 *
 * C'est le seul endroit où la forme exacte des octets publiés est décidée. Elle vit dans le
 * paquet partagé parce qu'un vérificateur — page publique, script tiers — doit pouvoir
 * reconstruire **exactement** les mêmes octets à partir des seules valeurs publiques pour
 * rehacher et confronter à l'ancre. Une divergence d'un espace suffirait à faire échouer une
 * vérification honnête.
 *
 * L'ordre des clés est écrit à la main plutôt que dérivé d'un objet : `JSON.stringify` suit
 * l'ordre d'insertion, qui dépendrait sinon du chemin de code appelant.
 */

export interface WitnessRecordSeal {
  merkleRoot: string;
  poolSize: number;
  sealRound: number;
  /** Instant du scellement (ISO 8601), tel qu'affiché publiquement. */
  sealedAt: string;
}

export interface WitnessRecordInput {
  /** Slug du tenant organisateur. */
  tenant: string;
  /** Slug du giveaway. Unique chez un tenant, donc un chemin de publication par concours. */
  giveaway: string;
  serverSeedHash: string;
  drandRound: number;
  /** Absent à la programmation, présent à la fermeture des inscriptions. */
  seal?: WitnessRecordSeal;
}

/** Ce qui est publié : l'engagement seul, ou l'engagement complété du sceau. */
export type WitnessPhase = 'commitment' | 'seal';

export function witnessPhaseOf(input: WitnessRecordInput): WitnessPhase {
  return input.seal === undefined ? 'commitment' : 'seal';
}

/**
 * Sérialise l'enregistrement à publier. Indenté sur deux espaces et terminé par un saut de
 * ligne : le fichier est destiné à être lu par un humain sur une page web tierce, et un
 * fichier texte se termine par une fin de ligne.
 */
export function buildWitnessPayload(input: WitnessRecordInput): string {
  const ordered: Record<string, unknown> = {
    tenant: input.tenant,
    giveaway: input.giveaway,
    serverSeedHash: input.serverSeedHash,
    drandRound: input.drandRound,
  };
  if (input.seal !== undefined) {
    ordered.seal = {
      merkleRoot: input.seal.merkleRoot,
      poolSize: input.seal.poolSize,
      sealRound: input.seal.sealRound,
      sealedAt: input.seal.sealedAt,
    };
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Empreinte de la charge publiée — celle que la plateforme conserve dans
 * `seal_witness.payload_sha256` et qu'un tiers doit pouvoir **recalculer**.
 *
 * Sans elle, l'ancrage externe reste une affirmation : un visiteur peut télécharger le reçu
 * OpenTimestamps, mais rien ne lui dit que ce qui a été ancré correspond aux valeurs qu'il a sous
 * les yeux. Il lui faudrait reconstruire la charge à la main, au caractère près.
 *
 * Cette fonction rend la confrontation mécanique : la page publique la calcule à partir des
 * seules valeurs affichées et la compare à l'empreinte publiée avec l'ancre. L'égalité établit
 * que **le dossier ancré est le dossier affiché** ; la **date**, elle, reste établie par le reçu
 * lui-même, ouvert contre un nœud Bitcoin — un geste humain que l'interface annonce comme tel.
 */
export function witnessPayloadSha256(input: WitnessRecordInput): string {
  return sha256Hex(buildWitnessPayload(input));
}
