import { sha256Hex } from '../draw/hash.js';
import { DrawEngineError } from '../draw/errors.js';

/**
 * Instant gagnant **vérifiable**.
 *
 * ## Le problème que ce module résout
 *
 * Un instant gagnant ordinaire est une boîte noire intégrale : le serveur annonce « perdu » et
 * personne, jamais, ne peut le contredire. C'est la mécanique la plus vendue du marché et la
 * moins vérifiable — Kimple et Qualifio la proposent tous les deux sans qu'aucun participant
 * puisse rien recalculer.
 *
 * ## La construction
 *
 * L'organisateur déclare **avant l'ouverture** : un nombre maximal de participations, un nombre
 * de lots, l'empreinte d'une graine secrète (`sha256(serverSeed)`), et le round drand qui sera
 * utilisé. Il ne peut alors plus rien changer : la graine est engagée, et la valeur drand
 * n'existe pas encore.
 *
 * À l'ouverture, la valeur drand est publiée. De `(serverSeed, drandValue)` se déduisent les
 * **positions gagnantes** : les `prizesCount` premières d'une permutation de `1..maxEntries`.
 * Chaque participation prend le numéro suivant et gagne si son numéro est dans cet ensemble.
 *
 * À la clôture, la graine est révélée. N'importe qui recalcule alors l'ensemble complet et
 * vérifie que **sa** participation a bien reçu ce qu'elle devait recevoir.
 *
 * ## Ce que cette construction garantit, et ce qu'elle ne garantit pas
 *
 * Elle garantit que le sort de chaque participation était **fixé avant qu'elle n'ait lieu**, et
 * qu'il est recalculable par tous. L'organisateur ne peut ni choisir ses gagnants après coup, ni
 * fabriquer la graine en fonction du drand — il s'engage avant que celui-ci n'existe.
 *
 * Elle ne prétend pas empêcher un organisateur de participer lui-même à son propre jeu en
 * connaissant les positions gagnantes. Aucun instant gagnant au monde ne le peut, et c'est le
 * règlement — qui exclut l'organisateur et ses proches — qui traite ce cas, exactement comme sur
 * un tirage programmé. La différence est qu'ici la fraude sur le **résultat** devient
 * impossible, là où ailleurs elle est simplement invisible.
 */

/** Engagement publié avant l'ouverture. Rien n'en bouge ensuite. */
export interface InstantCommitment {
  /** `sha256(serverSeed)`, publié avant que le round drand n'existe. */
  serverSeedHash: string;
  /** Round drand utilisé, annoncé à l'avance et postérieur à l'engagement. */
  drandRound: number;
  /** Plafond de participations. Borne la permutation, donc l'ensemble gagnant. */
  maxEntries: number;
  /** Nombre de lots à distribuer. Jamais dépassé, par construction. */
  prizesCount: number;
}

/**
 * Calcule les positions gagnantes (1-indexées), triées.
 *
 * Mélange de Fisher-Yates **partiel** : on ne tire que les `prizesCount` premières positions,
 * ce qui suffit et évite de matérialiser un tableau d'un million d'entrées pour en retenir dix.
 *
 * Le flux d'aléa est un compteur haché — `sha256(serverSeed|drandValue|i)` — plutôt qu'un
 * générateur à état : chaque valeur se recalcule isolément, donc un vérificateur peut refaire
 * n'importe quelle étape sans rejouer les précédentes.
 */
export function instantWinningPositions(
  serverSeed: string,
  drandValue: string,
  maxEntries: number,
  prizesCount: number,
): number[] {
  assertInstantBounds(maxEntries, prizesCount);

  // Positions représentées paresseusement : seules celles réellement déplacées sont stockées.
  // `maxEntries` peut valoir un million ; allouer le tableau entier pour en tirer dix serait
  // payer la taille du plafond plutôt que celle du besoin.
  const moved = new Map<number, number>();
  const at = (index: number): number => moved.get(index) ?? index;

  const winners: number[] = [];
  for (let j = 0; j < prizesCount; j += 1) {
    const span = maxEntries - j;
    const k = j + uniformBelow(serverSeed, drandValue, j, span);
    winners.push(at(k) + 1);
    moved.set(k, at(j));
    moved.set(j, at(k));
  }
  return winners.sort((a, b) => a - b);
}

/** Cette participation, à ce numéro d'ordre, est-elle gagnante ? */
export function isInstantWinner(positions: number[], entryPosition: number): boolean {
  return positions.includes(entryPosition);
}

/**
 * Vérifie un instant gagnant complet après révélation.
 *
 * Rend le détail plutôt qu'un booléen : un vérificateur qui dit seulement « non » n'aide
 * personne à comprendre ce qui cloche, et c'est précisément ce qu'on reproche aux boîtes noires.
 */
export function verifyInstantDraw(input: {
  commitment: InstantCommitment;
  serverSeed: string;
  drandValue: string;
  /** Positions annoncées comme gagnantes par l'organisateur. */
  announcedPositions: number[];
}): {
  seedMatchesCommitment: boolean;
  positionsMatch: boolean;
  expectedPositions: number[];
} {
  const seedMatchesCommitment = sha256Hex(input.serverSeed) === input.commitment.serverSeedHash;
  const expectedPositions = instantWinningPositions(
    input.serverSeed,
    input.drandValue,
    input.commitment.maxEntries,
    input.commitment.prizesCount,
  );
  const announced = [...input.announcedPositions].sort((a, b) => a - b);
  const positionsMatch =
    announced.length === expectedPositions.length &&
    announced.every((position, index) => position === expectedPositions[index]);
  return { seedMatchesCommitment, positionsMatch, expectedPositions };
}

/**
 * Entier uniforme dans `[0, span)`, tiré du flux `sha256(serverSeed|drandValue|step|attempt)`.
 *
 * **Rejet plutôt que modulo.** Un `% span` favorise les petites valeurs dès que `span` ne divise
 * pas 2²⁵⁶ — un biais infime, mais ici il porterait sur *quelles positions gagnent*, c'est-à-dire
 * sur la seule chose que ce module existe pour rendre incontestable. Le rejet coûte quelques
 * hachages supplémentaires et rend la distribution exacte.
 *
 * Le numéro de tentative entre dans le hachage : sans lui, un rejet relancerait le même calcul à
 * l'infini.
 */
function uniformBelow(serverSeed: string, drandValue: string, step: number, span: number): number {
  const bound = BigInt(span);
  // Plus grand multiple de `span` tenant dans 2²⁵⁶ : au-delà, on rejette.
  const limit = (1n << 256n) - ((1n << 256n) % bound);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const draw = BigInt(`0x${sha256Hex(`${serverSeed}|${drandValue}|${step}|${attempt}`)}`);
    if (draw < limit) {
      return Number(draw % bound);
    }
  }
  /* c8 ignore next 2 */
  // Inatteignable : la probabilité de mille rejets consécutifs est inférieure à 2⁻¹⁰⁰⁰.
  throw new DrawEngineError('tirage uniforme impossible : trop de rejets consécutifs');
}

function assertInstantBounds(maxEntries: number, prizesCount: number): void {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new DrawEngineError('maxEntries doit être un entier positif');
  }
  if (!Number.isInteger(prizesCount) || prizesCount < 1) {
    throw new DrawEngineError('prizesCount doit être un entier positif');
  }
  if (prizesCount > maxEntries) {
    throw new DrawEngineError('prizesCount ne peut pas dépasser maxEntries');
  }
}
