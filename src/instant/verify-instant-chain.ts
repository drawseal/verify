import { instantDesignations, type EntryPosition } from './instant-designations.js';
import { instantCatchup } from './instant-catchup.js';
import type { WeightInputParticipant, WeightingMode } from '../draw/compute-weights.js';
import type { PoolParticipant } from '../draw/pool.js';
import { neutralReferrals, referralsReproduceSealedWeights } from '../draw/sealed-weights.js';
import { activeWinnersMatch, type ChainEntry, type RankedWinner } from '../draw/active-winners.js';
import { chainWellFormed } from '../draw/chain-structure.js';

/** Une désignation de la chaîne d'un instant gagnant, telle que publiée. */
export interface InstantChainDesignation extends ChainEntry {
  /** Position dans la chronologie globale des désignations (0 = première). */
  order: number;
}

export interface VerifyInstantChainInput {
  /** Graine révélée à la clôture. */
  serverSeed: string;
  /** Valeur drand du round d'ouverture — celle qui décide des positions gagnantes. */
  openingDrandValue: string;
  maxEntries: number;
  /** Nombre de lots (`reveal.winnersCount`). */
  prizesCount: number;
  /** Numéros d'ordre publiés à la clôture, un par participation. */
  entryPositions: readonly EntryPosition[];
  /** Pool scellé (`reveal.participants`) : ids éligibles à la remise, et leurs poids scellés. */
  sealedPool: readonly PoolParticipant[];
  weightingMode: WeightingMode;
  /** Graphe de parrainage / entrées fournies — sans lui, les poids ne se recalculent pas. */
  referrals?: readonly WeightInputParticipant[];
  referralBonusEntries?: number;
  /** Plafond du bonus de parrainage (`null`/absent avant la version 4). */
  referralBonusCap?: number | null;
  /**
   * Le règlement engage-t-il un tirage de rattrapage (option activée **et** round engagé) ?
   *
   * C'est ce qui rend son absence contrôlable : rattrapage engagé et rang vacant, il DOIT avoir
   * eu lieu ; rattrapage non engagé, il ne PEUT pas avoir eu lieu.
   */
  catchupCommitted: boolean;
  /** Valeur drand du rattrapage, `null` s'il n'a pas eu lieu. */
  catchupDrandValue: string | null;
  /**
   * Chaîne complète des désignations. Vide sur un bundle antérieur à sa publication : les
   * gagnants annoncés tiennent alors lieu de désignations initiales.
   */
  designations: readonly InstantChainDesignation[];
  /** Gagnants annoncés — ceux que la page affiche. */
  claimedWinners: readonly RankedWinner[];
}

export interface VerifyInstantChainResult {
  /**
   * Chaque lot revient à qui le devait — position gagnante, puis rattrapage — et la liste annoncée
   * est exactement celle des désignations actives. Faux si l'un des contrôles ci-dessous l'est.
   */
  winnersOk: boolean;
  /** Chaque remplaçant après forfait se recalcule à partir des seules valeurs publiques. */
  redrawsOk: boolean;
  /**
   * Les numéros d'ordre sont bien formés : entiers dans `[1, maxEntries]`, une position par
   * participation et une participation par position.
   */
  positionsOk: boolean;
  /** Le rattrapage a eu lieu si et seulement si le règlement l'imposait. */
  catchupRuleOk: boolean;
  /** Les gagnants annoncés sont exactement les désignations actives de la chaîne. */
  activeWinnersOk: boolean;
  /**
   * Des poids recalculés étaient nécessaires (rattrapage ou remplacement) et le document ne
   * permet pas de les reproduire faute de `referrals`. Pas un verdict : « pas rejoué ».
   */
  weightsInconclusive: boolean;
  /** Remplaçants rejoués. */
  redrawCount: number;
  /** Rangs pourvus par le rattrapage. */
  catchupCount: number;
}

/**
 * Les numéros d'ordre publiés sont-ils ceux qu'une attribution honnête peut produire ?
 *
 * La plateforme attribue `max + 1` sous plafond, sous un index unique `(giveaway, position)`, à
 * une participation qui n'en a pas encore : jamais deux participations à la même position, jamais
 * deux positions pour une participation, jamais au-delà du plafond. La contiguïté, elle, n'est
 * PAS exigée — une participation effacée avant le scellement laisse un trou légitime.
 *
 * Une position tenue par un id absent du pool scellé n'est pas une anomalie non plus : c'est une
 * participation non confirmée ou écartée par l'anti-fraude, dont la position gagnante laisse le
 * rang vacant (règle annoncée au règlement).
 */
function entryPositionsWellFormed(entries: readonly EntryPosition[], maxEntries: number): boolean {
  const positions = new Set<number>();
  const ids = new Set<string>();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.position) || e.position < 1 || e.position > maxEntries) {
      return false;
    }
    if (positions.has(e.position) || ids.has(e.id)) {
      return false;
    }
    positions.add(e.position);
    ids.add(e.id);
  }
  return true;
}

/**
 * Rejoue **toute** la chaîne d'un instant gagnant : positions gagnantes, rattachement
 * position → rang → gagnant, rattrapage, remplacements après forfait — et la confronte aux
 * gagnants annoncés.
 *
 * Ne contrôle ni la graine, ni les beacons, ni le sceau : ce sont des contrôles distincts, que
 * l'appelant combine (voir la page publique). Ne lève pas sur un écart.
 *
 * ## Ce que ce rejeu ne peut PAS établir
 *
 * Les numéros d'ordre, `maxEntries`, le nombre de lots et le round de rattrapage ne sont couverts
 * par aucun engagement publié chez un témoin : la feuille scellée est `id:poids`. Celui qui écrit
 * le dossier peut donc encore permuter des positions bien formées entre participations scellées.
 * Le fermer exige de sceller les positions et d'engager ces paramètres — une évolution du format
 * du sceau et des témoins, pas un contrôle de plus ici.
 */
export function verifyInstantChain(input: VerifyInstantChainInput): VerifyInstantChainResult {
  const sealedIds = input.sealedPool.map((p) => p.id);
  const positionsOk = entryPositionsWellFormed(input.entryPositions, input.maxEntries);

  const replay = instantDesignations({
    serverSeed: input.serverSeed,
    drandValue: input.openingDrandValue,
    maxEntries: input.maxEntries,
    prizesCount: input.prizesCount,
    entryPositions: input.entryPositions,
    eligibleIds: sealedIds,
  });

  // Désignation initiale de chaque rang, puis remplaçants, dans la chronologie globale.
  const first = new Map<number, string>();
  const replacements: RankedWinner[] = [];
  const chain = [...input.designations].sort((a, b) => a.order - b.order);
  if (chain.length === 0) {
    for (const w of input.claimedWinners) {
      first.set(w.rank, w.participantId);
    }
  }
  for (const d of chain) {
    if (first.has(d.rank)) {
      replacements.push({ rank: d.rank, participantId: d.participantId });
    } else {
      first.set(d.rank, d.participantId);
    }
  }
  const activeWinnersOk = chain.length === 0 || activeWinnersMatch(chain, input.claimedWinners);

  // Structure de la chaîne : ordres uniques, rangs entiers dans [1, prizesCount], remplaçant
  // seulement après un forfait du même rang. Le rejeu ne produit que les rangs 1..prizesCount :
  // sans cette borne, une désignation hors plage n'était confrontée à rien, tout en devenant un
  // gagnant affiché. Sans chaîne, ce sont les gagnants annoncés qui en tiennent lieu — un par
  // rang, dans la même plage.
  const structureOk =
    chain.length === 0
      ? chainWellFormed(
          input.claimedWinners.map((w, i) => ({ order: i, rank: w.rank, status: 'pending' })),
          input.prizesCount,
        )
      : chainWellFormed(chain, input.prizesCount);

  const catchupRuleOk =
    input.catchupDrandValue === null
      ? !(input.catchupCommitted && replay.vacantRanks.length > 0)
      : input.catchupCommitted;

  // Poids des pools réduits : liés au sceau, ou rien.
  const referrals = input.referrals ?? neutralReferrals(input.sealedPool);
  const referralBonusEntries = input.referralBonusEntries ?? 0;
  const referralBonusCap = input.referralBonusCap ?? null;
  const catchupRuns = input.catchupDrandValue !== null && replay.vacantRanks.length > 0;
  const weightsNeeded = catchupRuns || replacements.length > 0;
  const weightsBound = referralsReproduceSealedWeights(
    input.sealedPool,
    input.weightingMode,
    referrals,
    referralBonusEntries,
    referralBonusCap,
  );
  const weightsInconclusive =
    weightsNeeded &&
    input.referrals === undefined &&
    (input.weightingMode === 'supplied' || !weightsBound);
  const weightsOk = weightsBound && !weightsInconclusive;

  const attribues = replay.designations
    .filter((d) => d.participantId !== null)
    .map((d) => d.participantId as string);

  // 1. Chaque lot dont la position a trouvé preneur revient à celui qui la tenait.
  let assignmentOk = replay.designations
    .filter((d) => d.participantId !== null)
    .every((d) => first.get(d.rank) === d.participantId);

  // 2. Les rangs vacants : pourvus par le rattrapage s'il a eu lieu, par personne sinon.
  const rattrapage = catchupRuns
    ? instantCatchup({
        serverSeed: input.serverSeed,
        catchupDrandValue: input.catchupDrandValue as string,
        weightingMode: input.weightingMode,
        sealedValidIds: sealedIds,
        referrals,
        referralBonusEntries,
        referralBonusCap,
        alreadyWinningIds: attribues,
        vacantRanks: replay.vacantRanks,
      })
    : null;
  const stillVacant = rattrapage ? rattrapage.stillVacantRanks : replay.vacantRanks;
  if (rattrapage) {
    assignmentOk =
      assignmentOk && rattrapage.winners.every((w) => first.get(w.rank) === w.participantId);
  }
  for (const rank of stillVacant) {
    assignmentOk = assignmentOk && !first.has(rank);
  }

  // 3. Les remplaçants : même graine, aléa du round qui avait désigné le rang, pool scellé privé
  //    de toutes les désignations antérieures.
  const exclus = [...first.values()];
  let replacementsOk = true;
  for (const r of replacements) {
    const aleaDuRang =
      rattrapage?.winners.some((w) => w.rank === r.rank) === true
        ? (input.catchupDrandValue as string)
        : input.openingDrandValue;
    const attendu = instantCatchup({
      serverSeed: input.serverSeed,
      catchupDrandValue: aleaDuRang,
      weightingMode: input.weightingMode,
      sealedValidIds: sealedIds,
      referrals,
      referralBonusEntries,
      referralBonusCap,
      alreadyWinningIds: exclus,
      vacantRanks: [r.rank],
    }).winners[0];
    replacementsOk = replacementsOk && attendu?.participantId === r.participantId;
    exclus.push(r.participantId);
  }

  return {
    winnersOk:
      structureOk &&
      positionsOk &&
      catchupRuleOk &&
      activeWinnersOk &&
      assignmentOk &&
      (!catchupRuns || weightsOk),
    redrawsOk: structureOk && replacementsOk && (replacements.length === 0 || weightsOk),
    positionsOk,
    catchupRuleOk,
    activeWinnersOk,
    weightsInconclusive,
    redrawCount: replacements.length,
    catchupCount: rattrapage ? rattrapage.winners.length : 0,
  };
}
