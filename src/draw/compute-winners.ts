import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import { sha256Hex } from './hash.js';
import { assertValidPool, computeFingerprint } from './pool.js';
import { pickWeighted } from './pick-weighted.js';
import { DrawEngineError } from './errors.js';
import type { PoolParticipant } from './pool.js';

/** Engagement publié **avant** le tirage (spec §3.1). */
export interface DrawCommitment {
  /** sha256(serverSeed) — publié avant, révélé après. */
  serverSeedHash: string;
  drandRound: number;
}

/** Entrées du calcul, au moment du tirage. */
export interface DrawInput {
  serverSeed: string;
  drandValue: string;
  winnersCount: number;
  /** Liste déjà nettoyée (anti-fraude en amont, incrément ultérieur). */
  participants: PoolParticipant[];
}

/** Un gagnant désigné. */
export interface DrawWinner {
  rank: number; // 1..winnersCount
  participantId: string;
  finalHash: string; // trace de vérification pour ce rang
}

/** Résultat du calcul. */
export interface DrawOutcome {
  participantsFingerprint: string;
  winners: DrawWinner[];
}

/** Graine serveur : 32 octets CSPRNG → hex (64 caractères). */
export function generateServerSeed(): string {
  return bytesToHex(randomBytes(32));
}

/** Engagement de la graine serveur : `sha256Hex(serverSeed)`. */
export function commitServerSeed(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

/**
 * finalHash d'un rang : lie graine serveur, aléa drand, rang et empreinte.
 * Séparateurs explicites (`|`) pour éviter toute collision de concaténation.
 *
 * Exportée : la vidéo animée dérive de cette empreinte les trajectoires de confettis du rang,
 * et le bundle public de vérification ne la transporte pas. La formule est **publiée** — elle
 * ne peut pas changer sans invalider toutes les vérifications déjà faites par les participants.
 */
export function computeRankFinalHash(
  serverSeed: string,
  drandValue: string,
  rank: number,
  participantsFingerprint: string,
): string {
  return sha256Hex(`${serverSeed}|${drandValue}|${rank}|${participantsFingerprint}`);
}

/**
 * Calcul **cascade** multi-lots (spec §4.5). L'empreinte est calculée **une
 * seule fois** sur la liste complète ; pour chaque rang de 1 à `winnersCount`,
 * on dérive le `finalHash` du rang, on sélectionne sur le **pool restant**, puis
 * on retire le gagnant avant le rang suivant. Déterministe et rejouable.
 */
export function computeWinners(input: DrawInput): DrawOutcome {
  const { serverSeed, drandValue, winnersCount, participants } = input;

  assertValidPool(participants);
  if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > participants.length) {
    throw new DrawEngineError(
      `winnersCount invalide : entier attendu dans [1, ${participants.length}] (reçu ${winnersCount})`,
    );
  }

  const participantsFingerprint = computeFingerprint(participants);
  let remaining = [...participants];
  const winners: DrawWinner[] = [];

  for (let rank = 1; rank <= winnersCount; rank++) {
    const finalHash = computeRankFinalHash(serverSeed, drandValue, rank, participantsFingerprint);
    const winner = pickWeighted(remaining, finalHash);
    winners.push({ rank, participantId: winner.id, finalHash });
    remaining = remaining.filter((p) => p.id !== winner.id);
  }

  return { participantsFingerprint, winners };
}
