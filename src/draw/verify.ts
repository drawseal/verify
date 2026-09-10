import { sha256Hex } from './hash.js';
import { computeWinners } from './compute-winners.js';
import {
  computePoolSeal,
  poolMatchesSeal,
  sealPrecedesRandomness,
  type PoolSeal,
} from './pool-seal.js';
import { verifyBeacon } from '../drand/verify-beacon.js';
import { verifyRedraws, type Designation } from './verify-redraws.js';
import type { WeightInputParticipant, WeightingMode } from './compute-weights.js';
import type { DrandBeacon } from '../drand/chain-info.js';
import type { DrawCommitment, DrawInput, DrawWinner } from './compute-winners.js';

/** Un gagnant annoncé, tel que publié par la plateforme. */
export interface ClaimedWinner {
  rank: number;
  participantId: string;
}

/**
 * Sceau de la liste des participants, publié à la **fermeture des inscriptions** — donc avant que
 * le round drand employé n'existe. Voir `pool-seal.ts` pour ce qu'il établit.
 */
export interface SealCommitment extends PoolSeal {
  /** Round drand courant à l'instant du scellement. */
  sealRound: number;
}

export interface VerifyInput {
  /** Engagement publié **avant** le tirage. */
  commitment: DrawCommitment;
  /**
   * Sceau du pool publié à la fermeture des inscriptions.
   *
   * Optionnel dans le type, mais son absence n'est jamais un succès : `poolSealOk` et
   * `sealOrderOk` valent alors `false`, et `ok` avec eux. Un tirage dont la liste n'a pas été
   * scellée n'est pas vérifiable — le dire est plus utile que de l'ignorer.
   */
  seal?: SealCommitment;
  /**
   * Beacon drand publié avec la révélation.
   *
   * Optionnel dans le type pour la même raison que `seal`, et avec la même conséquence : son
   * absence rend `beaconOk` — donc `ok` — faux. Un tirage dont on ne peut pas établir que l'aléa
   * employé est bien celui engagé n'est pas vérifiable.
   */
  beacon?: DrandBeacon;
  /** Données révélées **après** : graine, aléa, participants, winnersCount. */
  reveal: DrawInput;
  /** Gagnants annoncés par la plateforme, à recalculer. */
  claimedWinners: ClaimedWinner[];
  /**
   * Chaîne **complète** des désignations, cascade initiale et remplaçants confondus, ordonnée par
   * la chronologie globale.
   *
   * Absente sur un giveaway sans re-tirage, où `claimedWinners` suffit. Présente, elle prend le
   * pas : `claimedWinners` ne porte que les gagnants **actifs**, donc le remplaçant d'un rang
   * re-tiré — confronté à la cascade d'origine, il ferait échouer la vérification d'un tirage
   * honnête. C'est le défaut que ce champ corrige.
   */
  designations?: Designation[];
  /** Graphe de parrainage des participants valides — sans lui, les poids ne se recalculent pas. */
  referrals?: WeightInputParticipant[];
  /** Entrées bonus par filleul valide (0 hors action de parrainage). */
  referralBonusEntries?: number;
  /** Mode de pondération employé, nécessaire au rejeu des re-tirages. */
  weightingMode?: WeightingMode;
}

export interface VerifyResult {
  /** Vrai seulement si **tous** les contrôles ci-dessous le sont. */
  ok: boolean;
  /** `sha256(reveal.serverSeed) === commitment.serverSeedHash`. */
  seedHashOk: boolean;
  /**
   * La racine de Merkle recalculée sur la liste révélée égale celle scellée, taille comprise :
   * la liste utilisée pour le tirage est bien celle figée à la fermeture des inscriptions.
   */
  poolSealOk: boolean;
  /**
   * `sealRound < commitment.drandRound` : la liste a été scellée pendant une fenêtre de round
   * antérieure à celle du hasard employé, qui n'était donc pas connaissable à ce moment-là.
   */
  sealOrderOk: boolean;
  /**
   * Le beacon fourni est authentique (signature BLS valide sous la clé publique du réseau) **et**
   * c'est bien celui engagé : son round est celui de l'engagement, et sa randomness est l'aléa
   * rejoué. Les trois conditions sont indissociables — voir {@link verifyDraw}.
   */
  beaconOk: boolean;
  /** Gagnants recalculés === gagnants annoncés (rang à rang). */
  winnersOk: boolean;
  /**
   * Chaque remplaçant se recalcule à partir des seules valeurs publiques.
   *
   * Vaut `true` en l'absence de re-tirage — il n'y a alors rien à contredire. Un giveaway dont un
   * lot n'a pas été réclamé n'est donc plus déclaré invérifiable : il est déclaré conforme, avec
   * ses re-tirages rejoués.
   */
  redrawsOk: boolean;
  /** Nombre de remplaçants effectivement rejoués. */
  redrawCount: number;
  recomputedFingerprint: string;
  /** Racine de Merkle recalculée sur la liste révélée, à confronter au sceau publié. */
  recomputedMerkleRoot: string | null;
  winners: DrawWinner[];
}

/**
 * Rejoue **côté client** un tirage à partir des données publiques révélées et
 * confronte le résultat à l'engagement et aux gagnants annoncés.
 *
 * Ne lève **aucune** exception sur un écart : un écart de vérification est un
 * résultat auditable à afficher, pas une erreur. (Une entrée structurellement
 * malformée dans `reveal` propage en revanche `DrawEngineError` via
 * `computeWinners` — c'est une erreur de programmation, pas un écart.)
 */
export function verifyDraw(input: VerifyInput): VerifyResult {
  const { commitment, seal, beacon, reveal, claimedWinners } = input;

  const seedHashOk = sha256Hex(reveal.serverSeed) === commitment.serverSeedHash;

  // Les deux contrôles du scellement. Sans sceau publié, ils échouent : un tirage dont la liste
  // n'a pas été figée avant le hasard n'est pas vérifiable, et l'annoncer conforme serait faux.
  const poolSealOk = seal !== undefined && poolMatchesSeal(reveal.participants, seal);
  const sealOrderOk =
    seal !== undefined && sealPrecedesRandomness(seal.sealRound, commitment.drandRound);

  // Liaison beacon ↔ engagement. Une signature BLS valide **ne suffit pas** : elle établit que le
  // beacon vient bien de drand, pas qu'il s'agit de celui sur lequel la plateforme s'était
  // engagée. Sans les deux égalités qui suivent, un exploitant disposant d'un accès en écriture
  // à la base laisse `serverSeed` et son empreinte intacts — l'engagement témoin reste donc
  // valide — et substitue l'aléa par celui de n'importe quel autre round de l'historique drand,
  // choisi après coup pour que `computeWinners` désigne le participant voulu. Tous les autres
  // contrôles passeraient. C'est l'engagement sur le round, publié avant le scellement, qui
  // interdit ce choix ; ces égalités sont ce qui le fait respecter.
  const beaconOk =
    beacon !== undefined &&
    verifyBeacon(beacon) &&
    beacon.round === commitment.drandRound &&
    beacon.randomness === reveal.drandValue;

  const outcome = computeWinners(reveal);

  // Deux régimes, un seul verdict. Sans chaîne de désignations publiée, on confronte les gagnants
  // annoncés à la cascade — le comportement historique, correct tant qu'aucun rang n'a été
  // re-tiré. Avec la chaîne, c'est elle qui fait foi : elle porte la cascade initiale **et** les
  // remplaçants, et chacun est recalculé.
  const chain =
    input.designations !== undefined && input.designations.length > 0
      ? verifyRedraws({
          serverSeed: reveal.serverSeed,
          drandValue: reveal.drandValue,
          winnersCount: reveal.winnersCount,
          weightingMode: input.weightingMode ?? 'equal',
          sealedValidIds: reveal.participants.map((p) => p.id),
          referrals:
            input.referrals ??
            reveal.participants.map((p) => ({ id: p.id, referredByParticipantId: null })),
          referralBonusEntries: input.referralBonusEntries ?? 0,
          designations: input.designations,
        })
      : undefined;

  const winnersOk =
    chain !== undefined
      ? chain.ok
      : outcome.winners.length === claimedWinners.length &&
        outcome.winners.every((w) => {
          const claimed = claimedWinners.find((c) => c.rank === w.rank);
          return claimed !== undefined && claimed.participantId === w.participantId;
        });
  const redrawsOk = chain === undefined ? true : chain.ok;
  const redrawCount = chain?.replayed ?? 0;

  return {
    ok: seedHashOk && poolSealOk && sealOrderOk && beaconOk && winnersOk && redrawsOk,
    seedHashOk,
    poolSealOk,
    sealOrderOk,
    beaconOk,
    winnersOk,
    redrawsOk,
    redrawCount,
    recomputedFingerprint: outcome.participantsFingerprint,
    recomputedMerkleRoot: recomputedRoot(reveal.participants),
    winners: outcome.winners,
  };
}

/**
 * Racine recalculée, à afficher face au sceau publié pour que l'écart soit lisible et pas
 * seulement signalé. `null` sur une liste vide, où il n'y a rien à recalculer.
 */
function recomputedRoot(participants: DrawInput['participants']): string | null {
  if (participants.length === 0) {
    return null;
  }
  return computePoolSeal(participants).merkleRoot;
}
