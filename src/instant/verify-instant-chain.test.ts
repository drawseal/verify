import { describe, expect, it } from 'vitest';
import { verifyInstantChain, type VerifyInstantChainInput } from './verify-instant-chain.js';
import { instantDesignations } from './instant-designations.js';
import { instantCatchup } from './instant-catchup.js';
import { instantWinningPositions } from './instant-win.js';

/*
 * Le jeu de la reproduction du scan : cinq participations aux positions 1..5 sous un plafond de
 * 10, deux lots, rattrapage engagé. Les positions gagnantes et les gagnants honnêtes sont
 * **calculés** par le moteur, jamais recopiés : le test reste vrai si le moteur évolue.
 */
const SEED = 'dummy-seed';
const OPEN = 'a'.repeat(64);
const CATCH = 'b'.repeat(64);
const MAX = 10;
const pool = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, weight: 1 }));
const ids = pool.map((p) => p.id);
const flat = pool.map((p) => ({ id: p.id, referredByParticipantId: null, suppliedEntries: 1 }));
const honestEntries = pool.map((p, i) => ({ id: p.id, position: i + 1 }));
const winningPositions = instantWinningPositions(SEED, OPEN, MAX, 2);

/** Gagnants honnêtes par rang : position gagnante, sinon rattrapage. */
function honestWinners(entries = honestEntries): string[] {
  const rep = instantDesignations({
    serverSeed: SEED,
    drandValue: OPEN,
    maxEntries: MAX,
    prizesCount: 2,
    entryPositions: entries,
    eligibleIds: ids,
  });
  const attribues = rep.designations.filter((d) => d.participantId).map((d) => d.participantId!);
  const catchup = instantCatchup({
    serverSeed: SEED,
    catchupDrandValue: CATCH,
    weightingMode: 'equal',
    sealedValidIds: ids,
    referrals: flat,
    referralBonusEntries: 0,
    alreadyWinningIds: attribues,
    vacantRanks: rep.vacantRanks,
  });
  return [1, 2].map(
    (rank) =>
      rep.designations.find((d) => d.rank === rank)?.participantId ??
      catchup.winners.find((w) => w.rank === rank)!.participantId,
  );
}

function input(winners: string[], overrides: Partial<VerifyInstantChainInput> = {}) {
  const base: VerifyInstantChainInput = {
    serverSeed: SEED,
    openingDrandValue: OPEN,
    maxEntries: MAX,
    prizesCount: 2,
    entryPositions: honestEntries,
    sealedPool: pool,
    weightingMode: 'equal',
    referrals: flat,
    referralBonusEntries: 0,
    catchupCommitted: true,
    catchupDrandValue: CATCH,
    designations: winners.map((participantId, i) => ({
      order: i,
      rank: i + 1,
      participantId,
      status: 'pending',
    })),
    claimedWinners: winners.map((participantId, i) => ({ rank: i + 1, participantId })),
  };
  return { ...base, ...overrides };
}

describe('verifyInstantChain', () => {
  const honest = honestWinners();

  it('précondition : le jeu de la reproduction a un rang pourvu par le rattrapage', () => {
    // Une position gagnante au-delà des cinq participations : sans elle, le rattrapage et la règle
    // qui l'impose ne seraient pas exercés.
    expect(winningPositions.some((p) => p > honestEntries.length)).toBe(true);
  });

  it('témoin : un instant gagnant honnête, rattrapage compris, est conforme', () => {
    const res = verifyInstantChain(input(honest));
    expect(res).toMatchObject({
      winnersOk: true,
      redrawsOk: true,
      positionsOk: true,
      catchupRuleOk: true,
      activeWinnersOk: true,
      weightsInconclusive: false,
      catchupCount: 1,
    });
  });

  it('BLOQUANT (scan, falsification A) : lignes position→id ajoutées pour désigner deux complices', () => {
    const confed = ids.filter((id) => !honest.includes(id));
    const forgedEntries = [
      ...honestEntries,
      { id: confed[0]!, position: winningPositions[0]! },
      { id: confed[1]!, position: winningPositions[1]! },
    ];
    const res = verifyInstantChain(
      input([confed[0]!, confed[1]!], { entryPositions: forgedEntries }),
    );
    expect(res.positionsOk).toBe(false);
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : une position hors de [1, maxEntries] ou non entière invalide le verdict', () => {
    for (const position of [0, -1, MAX + 1, 2.5]) {
      const entries = [...honestEntries.slice(0, 4), { id: 'p5', position }];
      const res = verifyInstantChain(input(honest, { entryPositions: entries }));
      expect(res.positionsOk).toBe(false);
      expect(res.winnersOk).toBe(false);
    }
  });

  it('BLOQUANT : deux participations à la même position, ou deux positions pour une seule', () => {
    const samePosition = [...honestEntries.slice(0, 4), { id: 'p5', position: 4 }];
    expect(verifyInstantChain(input(honest, { entryPositions: samePosition })).positionsOk).toBe(
      false,
    );
    const twoPositions = [...honestEntries, { id: 'p1', position: 7 }];
    expect(verifyInstantChain(input(honest, { entryPositions: twoPositions })).positionsOk).toBe(
      false,
    );
  });

  it('accepte une position tenue par une participation hors du pool scellé (rang alors vacant)', () => {
    // Une participation non confirmée ou écartée par l'anti-fraude garde son numéro d'ordre ; si
    // c'est une position gagnante, le rang reste vacant et le rattrapage le remet en jeu. La
    // rejeter accuserait un tirage honnête.
    const entries = honestEntries.map((e) =>
      e.position === winningPositions[0] ? { id: 'exclu', position: e.position } : e,
    );
    const winners = honestWinners(entries);
    const res = verifyInstantChain(input(winners, { entryPositions: entries }));
    expect(res.positionsOk).toBe(true);
    expect(res.winnersOk).toBe(true);
    expect(res.catchupCount).toBe(2);
  });

  it('BLOQUANT : rattrapage engagé, rang vacant, et rattrapage absent → non conforme', () => {
    const vacant = winningPositions.findIndex((p) => p > honestEntries.length) + 1;
    const filled = honest.filter((_, i) => i + 1 !== vacant);
    const res = verifyInstantChain({
      ...input([]),
      catchupDrandValue: null,
      designations: filled.map((participantId) => ({
        order: 0,
        rank: 3 - vacant,
        participantId,
        status: 'pending',
      })),
      claimedWinners: filled.map((participantId) => ({ rank: 3 - vacant, participantId })),
    });
    expect(res.catchupRuleOk).toBe(false);
    expect(res.winnersOk).toBe(false);

    // Sans engagement de rattrapage, le même dossier est conforme : le rang vacant est un fait.
    expect(
      verifyInstantChain({
        ...input([]),
        catchupCommitted: false,
        catchupDrandValue: null,
        designations: filled.map((participantId) => ({
          order: 0,
          rank: 3 - vacant,
          participantId,
          status: 'pending',
        })),
        claimedWinners: filled.map((participantId) => ({ rank: 3 - vacant, participantId })),
      }).winnersOk,
    ).toBe(true);
  });

  it('BLOQUANT : un rattrapage que le règlement n’engageait pas → non conforme', () => {
    const res = verifyInstantChain(input(honest, { catchupCommitted: false }));
    expect(res.catchupRuleOk).toBe(false);
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : des gagnants affichés autres que la chaîne active → non conforme', () => {
    const fake = ids.find((id) => !honest.includes(id))!;
    const res = verifyInstantChain({
      ...input(honest),
      claimedWinners: [
        { rank: 1, participantId: fake },
        { rank: 2, participantId: honest[1]! },
      ],
    });
    expect(res.activeWinnersOk).toBe(false);
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : des entrées fournies inventées ne choisissent pas le gagnant du rattrapage', () => {
    // Le rattrapage pondère par les poids recalculés : ils doivent être ceux du sceau (tous à 1).
    const target = ids.find((id) => !honest.includes(id))!;
    const forged = flat.map((r) => ({ ...r, suppliedEntries: r.id === target ? 1_000_000 : 1 }));
    const vacant = winningPositions.findIndex((p) => p > honestEntries.length) + 1;
    const winners = honest.map((w, i) => (i + 1 === vacant ? target : w));
    const res = verifyInstantChain(
      input(winners, { weightingMode: 'supplied', referrals: forged }),
    );
    expect(res.winnersOk).toBe(false);
  });

  it('rejoue un remplaçant honnête, et refuse de conclure sans les entrées fournies', () => {
    const exclus = [...honest];
    const replacement = instantCatchup({
      serverSeed: SEED,
      catchupDrandValue: winningPositions[0]! > honestEntries.length ? CATCH : OPEN,
      weightingMode: 'equal',
      sealedValidIds: ids,
      referrals: flat,
      referralBonusEntries: 0,
      alreadyWinningIds: exclus,
      vacantRanks: [1],
    }).winners[0]!.participantId;
    const chain = [
      { order: 0, rank: 1, participantId: honest[0]!, status: 'forfeited' },
      { order: 1, rank: 2, participantId: honest[1]!, status: 'pending' },
      { order: 2, rank: 1, participantId: replacement, status: 'pending' },
    ];
    const claimed = [
      { rank: 1, participantId: replacement },
      { rank: 2, participantId: honest[1]! },
    ];
    const res = verifyInstantChain({
      ...input(honest),
      designations: chain,
      claimedWinners: claimed,
    });
    expect(res.redrawsOk).toBe(true);
    expect(res.winnersOk).toBe(true);
    expect(res.redrawCount).toBe(1);

    const sansEntrees = verifyInstantChain({
      ...input(honest),
      weightingMode: 'supplied',
      referrals: undefined,
      designations: chain,
      claimedWinners: claimed,
    });
    expect(sansEntrees.weightsInconclusive).toBe(true);
    expect(sansEntrees.redrawsOk).toBe(false);
  });

  it('bundle antérieur à la chaîne : les gagnants annoncés tiennent lieu de désignations', () => {
    const res = verifyInstantChain({ ...input(honest), designations: [] });
    expect(res.winnersOk).toBe(true);
  });

  /*
   * Rangs hors de [1, prizesCount] : le rejeu ne produit que les rangs 1..prizesCount, et rien ne
   * confrontait les autres à quoi que ce soit — alors que l'égalité avec la chaîne active les
   * faisait afficher comme gagnants. Un badge vert côtoyait un « gagnant » qui n'était même pas
   * dans le pool scellé.
   */
  it('BLOQUANT : une désignation sur un rang hors de [1, prizesCount] invalide le verdict', () => {
    for (const rank of [3, 0, -1, 2.5]) {
      const base = input(honest);
      const res = verifyInstantChain({
        ...base,
        designations: [
          ...base.designations,
          { order: 2, rank, participantId: 'not-in-pool', status: 'pending' },
        ],
        claimedWinners: [...base.claimedWinners, { rank, participantId: 'not-in-pool' }],
      });
      expect(res.winnersOk).toBe(false);
    }
  });

  it('BLOQUANT : sans chaîne, un gagnant annoncé hors de [1, prizesCount] invalide le verdict', () => {
    const base = input(honest);
    const res = verifyInstantChain({
      ...base,
      designations: [],
      claimedWinners: [...base.claimedWinners, { rank: 3, participantId: 'not-in-pool' }],
    });
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : sans chaîne, deux gagnants annoncés sur le même rang invalident le verdict', () => {
    const base = input(honest);
    const res = verifyInstantChain({
      ...base,
      designations: [],
      claimedWinners: [{ rank: 1, participantId: 'not-in-pool' }, ...base.claimedWinners],
    });
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : des ordres dupliqués, ou un remplaçant sans forfait, invalident le verdict', () => {
    const base = input(honest);
    const duplicate = verifyInstantChain({
      ...base,
      designations: base.designations.map((d) => ({ ...d, order: 0 })),
    });
    expect(duplicate.winnersOk).toBe(false);

    const sansForfait = verifyInstantChain({
      ...base,
      designations: [
        ...base.designations,
        { order: 2, rank: 1, participantId: 'p5', status: 'pending' },
      ],
      claimedWinners: [...base.claimedWinners, { rank: 1, participantId: 'p5' }],
    });
    expect(sansForfait.winnersOk).toBe(false);
  });
});
