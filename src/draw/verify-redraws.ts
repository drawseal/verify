import {
  computeWeights,
  type WeightInputParticipant,
  type WeightingMode,
} from './compute-weights.js';
import { computeWinners } from './compute-winners.js';

/**
 * Une désignation de gagnant, telle que publiée : la cascade initiale et chaque remplaçant
 * figurent dans la même liste, ordonnée par la chronologie **globale** du giveaway.
 *
 * L'ordre global est ce qui rend le rejeu possible. À chaque étape, l'ensemble exclu est celui
 * des désignations qui la précèdent — tous rangs confondus. Un ordre par rang seul ne suffirait
 * pas : si les rangs 1 et 2 ont chacun subi un forfait, le pool employé au second re-tirage
 * dépend de savoir lequel a eu lieu en premier.
 */
export interface Designation {
  /** Position dans la chronologie globale des désignations (0 = première). */
  order: number;
  rank: number;
  participantId: string;
  status: 'pending' | 'confirmed' | 'forfeited';
}

export interface VerifyRedrawsInput {
  /** Graine serveur révélée, identique pour la cascade initiale et tous les re-tirages. */
  serverSeed: string;
  /** Aléa drand révélé, idem. */
  drandValue: string;
  /** Nombre de lots, donc de rangs de la cascade initiale. */
  winnersCount: number;
  weightingMode: WeightingMode;
  /** Ids valides retenus au scellement, dans l'ordre scellé. */
  sealedValidIds: string[];
  /** Graphe de parrainage des participants valides — nécessaire pour recalculer les poids. */
  referrals: WeightInputParticipant[];
  /** Entrées bonus par filleul valide (0 si le giveaway n'a pas d'action de parrainage). */
  referralBonusEntries: number;
  designations: Designation[];
}

export interface RedrawMismatch {
  order: number;
  rank: number;
  /** Participant que le calcul impose. */
  expected: string;
  /** Participant réellement annoncé. */
  claimed: string;
}

export interface VerifyRedrawsResult {
  /** Vrai si la cascade initiale **et** tous les re-tirages se recalculent à l'identique. */
  ok: boolean;
  /** Nombre de remplaçants effectivement rejoués (hors cascade initiale). */
  replayed: number;
  /** Premier écart rencontré, s'il y en a un — l'endroit exact à montrer. */
  firstMismatch?: RedrawMismatch;
  /**
   * Vrai si le pool valide a été entièrement consommé par les désignations successives.
   *
   * Ce n'est pas une anomalie : c'est un fait, à distinguer d'un écart de calcul pour que la page
   * publique n'accuse pas un organisateur dont tous les gagnants ont renoncé.
   */
  poolExhausted: boolean;
}

/**
 * Rejoue **toute** la chaîne de désignations d'un giveaway : la cascade initiale, puis chaque
 * remplaçant, à partir des seules valeurs publiées.
 *
 * ## Pourquoi cette fonction existe
 *
 * Le bundle public ne portait que les gagnants **actifs**. Sur un rang re-tiré, le remplaçant
 * était donc confronté à la cascade d'origine, qui désigne quelqu'un d'autre : la vérification
 * échouait, et la page annonçait « ce tirage ne se vérifie pas » sur un giveaway parfaitement
 * honnête. Comme un lot non réclamé déclenche un forfait automatique, le cas était appelé à
 * devenir courant — et un verdict rouge banalisé ne protège plus de rien.
 *
 * ## Ce que le rejeu établit
 *
 * Rien dans un re-tirage n'est aléatoire : mêmes graines déjà révélées, `winnersCount: 1`, et un
 * pool réduit par une règle publique — les participants valides moins **tous** ceux déjà
 * désignés, forfaités compris (un forfaité n'est jamais repêché). Le remplaçant est donc
 * entièrement déterminé par des valeurs publiques. Le rejouer transforme le re-tirage d'un fait
 * qu'on annonce en un fait qu'on démontre — et ferme l'abus symétrique : un organisateur qui
 * forfaiterait un gagnant légitime pour déplacer un lot ne peut pas choisir son remplaçant.
 *
 * ## Le piège des poids
 *
 * Le pool d'un re-tirage n'est pas le pool scellé privé de quelques lignes. En mode `weighted`,
 * retirer un participant retire aussi un filleul valide à son parrain, dont le poids diminue.
 * D'où le recalcul complet des poids à chaque étape, à partir du graphe de parrainage publié.
 */
export function verifyRedraws(input: VerifyRedrawsInput): VerifyRedrawsResult {
  // Tri défensif : l'ordre gouverne l'ensemble exclu à chaque étape, on ne le prend pas sur parole.
  const ordered = [...input.designations].sort((a, b) => a.order - b.order);

  const poolFor = (validIds: string[]) =>
    computeWeights({
      weightingMode: input.weightingMode,
      validIds,
      participants: input.referrals,
      referralBonusEntries: input.referralBonusEntries,
    });

  // Cascade initiale : la première désignation de chaque rang, prise dans l'ordre des rangs.
  const initial: Designation[] = [];
  const seenRanks = new Set<number>();
  for (const d of ordered) {
    if (!seenRanks.has(d.rank)) {
      seenRanks.add(d.rank);
      initial.push(d);
    }
  }
  initial.sort((a, b) => a.rank - b.rank);

  const cascade = computeWinners({
    serverSeed: input.serverSeed,
    drandValue: input.drandValue,
    winnersCount: input.winnersCount,
    participants: poolFor(input.sealedValidIds),
  }).winners;

  for (const claimed of initial) {
    const expected = cascade.find((w) => w.rank === claimed.rank);
    if (expected === undefined || expected.participantId !== claimed.participantId) {
      return {
        ok: false,
        replayed: 0,
        poolExhausted: false,
        firstMismatch: {
          order: claimed.order,
          rank: claimed.rank,
          expected: expected?.participantId ?? '',
          claimed: claimed.participantId,
        },
      };
    }
  }

  // Puis chaque remplaçant, dans l'ordre, sur le pool privé de tout ce qui précède.
  const initialOrders = new Set(initial.map((d) => d.order));
  const designated = new Set<string>();
  let replayed = 0;
  let poolExhausted = false;

  for (const d of ordered) {
    if (initialOrders.has(d.order)) {
      designated.add(d.participantId);
      continue;
    }
    const remaining = input.sealedValidIds.filter((id) => !designated.has(id));
    if (remaining.length === 0) {
      // Plus personne à désigner : une ligne annoncée ici ne peut pas dériver du calcul.
      return {
        ok: false,
        replayed,
        poolExhausted: true,
        firstMismatch: { order: d.order, rank: d.rank, expected: '', claimed: d.participantId },
      };
    }
    const expected = computeWinners({
      serverSeed: input.serverSeed,
      drandValue: input.drandValue,
      winnersCount: 1,
      participants: poolFor(remaining),
    }).winners[0].participantId;

    if (expected !== d.participantId) {
      return {
        ok: false,
        replayed,
        poolExhausted: false,
        firstMismatch: { order: d.order, rank: d.rank, expected, claimed: d.participantId },
      };
    }
    designated.add(d.participantId);
    replayed += 1;
  }

  poolExhausted = input.sealedValidIds.every((id) => designated.has(id));
  return { ok: true, replayed, poolExhausted };
}
