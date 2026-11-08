import { describe, it, expect } from 'vitest';
import { verifyDraw } from './verify.js';
import { computeWinners, commitServerSeed } from './compute-winners.js';
import { computePoolSeal } from './pool-seal.js';
import { computeWeights } from './compute-weights.js';
import { verifyRedraws } from './verify-redraws.js';
import type { VerifyInput } from './verify.js';
import type { DrawInput } from './compute-winners.js';
import type { PoolParticipant } from './pool.js';
import type { DrandBeacon } from '../drand/chain-info.js';

const participants: PoolParticipant[] = [
  { id: 'p1', weight: 1 },
  { id: 'p2', weight: 1 },
  { id: 'p3', weight: 1 },
  { id: 'p4', weight: 1 },
];

/**
 * Vecteur réel quicknet (round 1 000 000), figé pour une vérification offline — le même que
 * `drand/verify-beacon.test.ts`. Le beacon ne peut pas être fabriqué : sa signature BLS est
 * vérifiée pour de bon, et c'est précisément ce qui donne du sens aux deux liaisons testées
 * plus bas.
 */
const REAL_BEACON: DrandBeacon = {
  round: 1_000_000,
  randomness: 'b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
  signature:
    '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
};

const reveal: DrawInput = {
  serverSeed: 'seed-serveur-revele',
  // L'aléa rejoué est celui du beacon : c'est l'égalité que `beaconOk` exige.
  drandValue: REAL_BEACON.randomness,
  winnersCount: 2,
  participants,
};

function buildVerifyInput(): VerifyInput {
  const outcome = computeWinners(reveal);
  return {
    commitment: {
      serverSeedHash: commitServerSeed(reveal.serverSeed),
      drandRound: REAL_BEACON.round,
    },
    // Sceau publié à la fermeture des inscriptions, dans une fenêtre de round antérieure à celle
    // du hasard employé.
    seal: { ...computePoolSeal(participants), sealRound: REAL_BEACON.round - 1 },
    beacon: REAL_BEACON,
    reveal,
    claimedWinners: outcome.winners.map((w) => ({ rank: w.rank, participantId: w.participantId })),
  };
}

describe('verifyDraw', () => {
  it('cas nominal → tous les contrôles passent', () => {
    const res = verifyDraw(buildVerifyInput());
    expect(res.ok).toBe(true);
    expect(res.seedHashOk).toBe(true);
    expect(res.poolSealOk).toBe(true);
    expect(res.sealOrderOk).toBe(true);
    expect(res.beaconOk).toBe(true);
    expect(res.winnersOk).toBe(true);
    expect(res.recomputedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(res.recomputedMerkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  // Le scellement est ce qui rend le tirage démontrable : sans lui, la liste a pu bouger après
  // que le hasard soit devenu public, et l'annoncer conforme serait faux.
  it('BLOQUANT : sans sceau publié, la vérification échoue', () => {
    const withoutSeal: VerifyInput = { ...buildVerifyInput(), seal: undefined };
    const res = verifyDraw(withoutSeal);
    expect(res.poolSealOk).toBe(false);
    expect(res.sealOrderOk).toBe(false);
    expect(res.ok).toBe(false);
    // Le reste du tirage est pourtant intact : l'échec porte bien sur le scellement seul.
    expect(res.seedHashOk).toBe(true);
    expect(res.winnersOk).toBe(true);
  });

  // L'attaque que le sceau ferme : glisser une entrée après avoir vu le tirage sortir.
  it('BLOQUANT : liste révélée différente de la liste scellée → poolSealOk=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      seal: { ...computePoolSeal([...participants, { id: 'p5', weight: 1 }]), sealRound: 122 },
    };
    const res = verifyDraw(tampered);
    expect(res.poolSealOk).toBe(false);
    expect(res.ok).toBe(false);
  });

  // Un scellement postérieur — ou même simultané — au round employé ne prouve plus rien : la
  // liste aurait pu être figée en connaissant déjà le hasard.
  it('BLOQUANT : scellement non antérieur au round du hasard → sealOrderOk=false', () => {
    const base = buildVerifyInput();
    for (const sealRound of [REAL_BEACON.round, REAL_BEACON.round + 1]) {
      const res = verifyDraw({ ...base, seal: { ...base.seal!, sealRound } });
      expect(res.sealOrderOk).toBe(false);
      expect(res.ok).toBe(false);
    }
  });

  it('rend la racine recalculée pour que l’écart soit lisible, pas seulement signalé', () => {
    const base = buildVerifyInput();
    expect(verifyDraw(base).recomputedMerkleRoot).toBe(base.seal?.merkleRoot);
  });

  it('serverSeed altéré (hash d’engagement ne correspond pas) → seedHashOk=false, ok=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      commitment: { ...base.commitment, serverSeedHash: 'f'.repeat(64) },
    };
    const res = verifyDraw(tampered);
    expect(res.seedHashOk).toBe(false);
    expect(res.ok).toBe(false);
  });

  it('gagnant annoncé altéré → winnersOk=false, ok=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      claimedWinners: base.claimedWinners.map((w, i) =>
        i === 0 ? { ...w, participantId: 'imposteur' } : w,
      ),
    };
    const res = verifyDraw(tampered);
    expect(res.winnersOk).toBe(false);
    expect(res.ok).toBe(false);
  });

  it('nombre de gagnants annoncés incohérent → winnersOk=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = { ...base, claimedWinners: [base.claimedWinners[0]] };
    const res = verifyDraw(tampered);
    expect(res.winnersOk).toBe(false);
    expect(res.ok).toBe(false);
  });

  // ─── Liaison beacon ↔ engagement ────────────────────────────────────────────────────────
  //
  // C'est l'attaque qui contredit le plus directement la promesse du produit : l'exploitant
  // laisse la graine et son empreinte intactes — l'engagement témoin reste donc valide — et
  // substitue l'aléa par celui d'un autre round drand, authentique, choisi après coup pour
  // désigner le participant voulu. Sans ces contrôles, `verifyDraw` répondait `ok: true`.

  it('BLOQUANT : sans beacon publié, la vérification échoue', () => {
    const withoutBeacon: VerifyInput = { ...buildVerifyInput(), beacon: undefined };
    const res = verifyDraw(withoutBeacon);
    expect(res.beaconOk).toBe(false);
    expect(res.ok).toBe(false);
    // Le reste est intact : l'échec porte bien sur le beacon seul.
    expect(res.seedHashOk).toBe(true);
    expect(res.poolSealOk).toBe(true);
    expect(res.winnersOk).toBe(true);
  });

  it('BLOQUANT : beacon authentique mais round ≠ round engagé → beaconOk=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      commitment: { ...base.commitment, drandRound: REAL_BEACON.round + 7 },
      // Le sceau reste antérieur au round engagé : seul le lien beacon ↔ engagement est rompu.
      seal: { ...base.seal!, sealRound: REAL_BEACON.round + 6 },
    };
    const res = verifyDraw(tampered);
    expect(res.beaconOk).toBe(false);
    expect(res.sealOrderOk).toBe(true);
    expect(res.ok).toBe(false);
  });

  it('BLOQUANT : aléa rejoué ≠ randomness du beacon → beaconOk=false', () => {
    const base = buildVerifyInput();
    const substituted = { ...base.reveal, drandValue: 'a'.repeat(64) };
    const outcome = computeWinners(substituted);
    const tampered: VerifyInput = {
      ...base,
      reveal: substituted,
      // Les gagnants annoncés sont ceux du tirage substitué : `winnersOk` passe, et c'est bien
      // pour ça que `beaconOk` est le seul rempart contre cette attaque.
      claimedWinners: outcome.winners.map((w) => ({
        rank: w.rank,
        participantId: w.participantId,
      })),
    };
    const res = verifyDraw(tampered);
    expect(res.winnersOk).toBe(true);
    expect(res.seedHashOk).toBe(true);
    expect(res.beaconOk).toBe(false);
    expect(res.ok).toBe(false);
  });

  it('BLOQUANT : beacon dont la signature ne tient pas → beaconOk=false', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      beacon: { ...REAL_BEACON, signature: REAL_BEACON.signature.replace(/^83ad/, '83ae') },
    };
    expect(verifyDraw(tampered).beaconOk).toBe(false);
    expect(verifyDraw(tampered).ok).toBe(false);
  });

  it('ne lève jamais d’exception sur un écart', () => {
    const base = buildVerifyInput();
    const tampered: VerifyInput = {
      ...base,
      commitment: { ...base.commitment, serverSeedHash: '00' },
      claimedWinners: [],
    };
    expect(() => verifyDraw(tampered)).not.toThrow();
  });
});

/**
 * Un vérificateur qui ne peut pas recalculer doit **refuser de conclure**, jamais conclure à
 * tort. En pondération `supplied`, les poids viennent des entrées fournies publiées dans
 * `referrals` : sans elles, ils ne se déduisent d'aucune autre donnée du document. Les ramener
 * silencieusement à 1 rendait « ce tirage ne se vérifie pas » sur un tirage honnête — le seul
 * mode d'échec que ce produit ne peut pas se permettre.
 */
describe('verifyDraw — re-tirages non concluants faute de données', () => {
  const cascade = computeWinners(reveal).winners;
  // Le rang 1 forfaite : son remplaçant est entièrement déterminé par les valeurs publiques,
  // sur le pool privé des deux déjà désignés. On le **calcule** plutôt que de l'inventer, sans
  // quoi la chaîne serait en écart et `replayed` ne prouverait rien.
  const alreadyDesignated = cascade.map((w) => w.participantId);
  const replacement = computeWinners({
    ...reveal,
    winnersCount: 1,
    participants: participants.filter((p) => !alreadyDesignated.includes(p.id)),
  }).winners[0]!.participantId;

  function suppliedInput(): VerifyInput {
    return {
      ...buildVerifyInput(),
      // Les gagnants annoncés sont les désignations actives : le remplaçant au rang 1.
      claimedWinners: [
        { rank: 1, participantId: replacement },
        { rank: 2, participantId: cascade[1]!.participantId },
      ],
      weightingMode: 'supplied',
      designations: [
        { order: 0, rank: 1, participantId: cascade[0]!.participantId, status: 'forfeited' },
        { order: 1, rank: 2, participantId: cascade[1]!.participantId, status: 'confirmed' },
        { order: 2, rank: 1, participantId: replacement, status: 'confirmed' },
      ],
    };
  }

  it('signale l’impossibilité de conclure plutôt qu’un verdict, en `supplied` sans `referrals`', () => {
    const res = verifyDraw(suppliedInput());

    expect(res.redrawsInconclusive).toBe(true);
    // Rien n'a été rejoué : aucun verdict n'a été rendu sur des poids inventés.
    expect(res.redrawCount).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('conclut normalement dès que les entrées fournies sont publiées', () => {
    const res = verifyDraw({
      ...suppliedInput(),
      referrals: participants.map((p) => ({
        id: p.id,
        referredByParticipantId: null,
        suppliedEntries: p.weight,
      })),
    });

    expect(res.redrawsInconclusive).toBe(false);
    expect(res.redrawsOk).toBe(true);
    expect(res.redrawCount).toBe(1);
    expect(res.ok).toBe(true);
  });

  /**
   * Le repli neutre reste juste en `equal` et en `weighted` sans graphe : les poids y valent 1
   * par construction. Ce test interdit d'étendre l'abstention à ces modes, où elle priverait de
   * verdict des tirages parfaitement vérifiables.
   */
  it('ne s’applique pas aux modes `equal` et `weighted`', () => {
    for (const weightingMode of ['equal', 'weighted'] as const) {
      const res = verifyDraw({ ...suppliedInput(), weightingMode });
      expect(res.redrawsInconclusive).toBe(false);
      expect(res.redrawCount).toBe(1);
    }
  });
});

/**
 * Les poids employés par la chaîne de désignations doivent être **ceux du sceau**.
 *
 * Avec une chaîne publiée, le rejeu recalcule les poids à partir de `weightingMode`, `referrals`
 * et `referralBonusEntries` — trois champs qu'aucun engagement ne couvre. Sans liaison au pool
 * scellé, un document pouvait garder l'engagement, la graine, le beacon et le sceau d'un tirage
 * honnête, réécrire ces trois champs pour qu'un autre participant gagne, et passer les sept
 * contrôles. Après la révélation, n'importe qui pouvait le faire sur une copie du bundle public.
 */
describe('verifyDraw — poids de la chaîne liés au pool scellé', () => {
  const single: DrawInput = { ...reveal, winnersCount: 1 };
  const honest = computeWinners(single).winners[0]!.participantId;
  // Le participant que le document falsifié désigne : n'importe qui sauf le vrai gagnant.
  const forgedWinner = participants.find((p) => p.id !== honest)!.id;

  function singleInput(): VerifyInput {
    return {
      ...buildVerifyInput(),
      reveal: single,
      claimedWinners: [{ rank: 1, participantId: forgedWinner }],
    };
  }

  // Le document de la reproduction : pool scellé à poids égaux, entrées fournies inventées.
  const forgedReferrals = participants.map((p) => ({
    id: p.id,
    referredByParticipantId: null,
    suppliedEntries: p.id === forgedWinner ? 1_000_000 : 1,
  }));

  it('BLOQUANT : des entrées fournies inventées ne font pas gagner un autre participant', () => {
    // Précondition : sur ces poids inventés, le rejeu de la chaîne désigne bien le faux gagnant.
    // Sans elle, l'échec ci-dessous ne prouverait rien sur l'attaque.
    expect(
      verifyRedraws({
        serverSeed: single.serverSeed,
        drandValue: single.drandValue,
        winnersCount: 1,
        weightingMode: 'supplied',
        sealedValidIds: participants.map((p) => p.id),
        referrals: forgedReferrals,
        referralBonusEntries: 0,
        designations: [{ order: 0, rank: 1, participantId: forgedWinner, status: 'pending' }],
      }).ok,
    ).toBe(true);

    const res = verifyDraw({
      ...singleInput(),
      weightingMode: 'supplied',
      referrals: forgedReferrals,
      designations: [{ order: 0, rank: 1, participantId: forgedWinner, status: 'pending' }],
    });

    expect(res.ok).toBe(false);
    expect(res.winnersOk).toBe(false);
    expect(res.redrawsOk).toBe(false);
    // L'échec porte bien sur les poids : tout ce que couvrent les engagements est intact.
    expect(res.seedHashOk).toBe(true);
    expect(res.poolSealOk).toBe(true);
    expect(res.sealOrderOk).toBe(true);
    expect(res.beaconOk).toBe(true);
  });

  it('BLOQUANT : un graphe de parrainage inventé ne fait pas gagner un autre participant', () => {
    // Bonus énorme, quatre filleuls rattachés au faux gagnant : le pool scellé, lui, est à poids
    // égaux. Le mode annoncé ne change rien à l'affaire.
    const res = verifyDraw({
      ...singleInput(),
      weightingMode: 'weighted',
      referralBonusEntries: 1_000_000,
      referrals: participants.map((p) => ({
        id: p.id,
        referredByParticipantId: p.id === forgedWinner ? null : forgedWinner,
        suppliedEntries: 1,
      })),
      designations: [{ order: 0, rank: 1, participantId: forgedWinner, status: 'pending' }],
    });

    expect(res.ok).toBe(false);
    expect(res.winnersOk).toBe(false);
    expect(res.poolSealOk).toBe(true);
  });

  it('BLOQUANT : une cascade initiale qui n’est pas celle du pool scellé échoue', () => {
    const res = verifyDraw({
      ...singleInput(),
      designations: [{ order: 0, rank: 1, participantId: forgedWinner, status: 'pending' }],
    });
    expect(res.ok).toBe(false);
    expect(res.winnersOk).toBe(false);
  });

  it('BLOQUANT : des lignes de parrainage dupliquées ou étrangères au pool scellé échouent', () => {
    // Un filleul compté deux fois donne au parrain le poids scellé, mais lui en retire deux d'un
    // coup quand ce filleul est désigné : le pool d'un re-tirage cesserait de dériver du sceau.
    const sealed: PoolParticipant[] = [
      { id: 'p1', weight: 3 },
      { id: 'p2', weight: 1 },
      { id: 'p3', weight: 1 },
      { id: 'p4', weight: 1 },
    ];
    const sealedReveal: DrawInput = { ...single, participants: sealed };
    const winner = computeWinners(sealedReveal).winners[0]!.participantId;
    const base: VerifyInput = {
      ...buildVerifyInput(),
      reveal: sealedReveal,
      seal: { ...computePoolSeal(sealed), sealRound: REAL_BEACON.round - 1 },
      claimedWinners: [{ rank: 1, participantId: winner }],
      weightingMode: 'weighted',
      referralBonusEntries: 1,
      designations: [{ order: 0, rank: 1, participantId: winner, status: 'pending' }],
    };
    const row = (id: string, sponsor: string | null) => ({
      id,
      referredByParticipantId: sponsor,
      suppliedEntries: 1,
    });

    // Témoin : le graphe honnête (p2 et p3 filleuls de p1) se vérifie.
    const honestGraph = [row('p1', null), row('p2', 'p1'), row('p3', 'p1'), row('p4', null)];
    expect(verifyDraw({ ...base, referrals: honestGraph }).ok).toBe(true);

    // Même nombre de lignes, mêmes poids pleins (p1 = 1 + 2) : seule la ligne de p3 a disparu.
    const duplicated = [row('p1', null), row('p2', 'p1'), row('p2', 'p1'), row('p4', null)];
    const res = verifyDraw({ ...base, referrals: duplicated });
    expect(res.ok).toBe(false);
    expect(res.winnersOk).toBe(false);

    const outsider = [...honestGraph, row('intrus', null)];
    expect(verifyDraw({ ...base, referrals: outsider }).ok).toBe(false);
  });

  it('un tirage pondéré honnête, re-tirage compris, reste vérifiable', () => {
    // p1 parraine p2 et p3 : son poids scellé est 1 + 2 × 2 = 5. Le re-tirage recalcule les
    // poids sur le pool réduit, d'après le même graphe — c'est ce que le sceau rend contrôlable.
    const graph = [
      { id: 'p1', referredByParticipantId: null, suppliedEntries: 1 },
      { id: 'p2', referredByParticipantId: 'p1', suppliedEntries: 1 },
      { id: 'p3', referredByParticipantId: 'p1', suppliedEntries: 1 },
      { id: 'p4', referredByParticipantId: null, suppliedEntries: 1 },
    ];
    const ids = graph.map((g) => g.id);
    const weigh = (validIds: string[]) =>
      computeWeights({
        weightingMode: 'weighted',
        validIds,
        participants: graph,
        referralBonusEntries: 2,
      });
    const sealed = weigh(ids);
    const sealedReveal: DrawInput = { ...single, participants: sealed };
    const first = computeWinners(sealedReveal).winners[0]!.participantId;
    const replacement = computeWinners({
      ...sealedReveal,
      participants: weigh(ids.filter((id) => id !== first)),
    }).winners[0]!.participantId;

    const res = verifyDraw({
      ...buildVerifyInput(),
      reveal: sealedReveal,
      seal: { ...computePoolSeal(sealed), sealRound: REAL_BEACON.round - 1 },
      claimedWinners: [{ rank: 1, participantId: replacement }],
      weightingMode: 'weighted',
      referralBonusEntries: 2,
      referrals: graph,
      designations: [
        { order: 0, rank: 1, participantId: first, status: 'forfeited' },
        { order: 1, rank: 1, participantId: replacement, status: 'confirmed' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.redrawCount).toBe(1);
  });

  it('refuse de conclure, sans accuser, sur un document pondéré privé de son graphe', () => {
    // Poids scellés > 1 et pas de `referrals` : le repli à 1 ne les reproduit pas. Ce n'est pas
    // une falsification démontrée, c'est un document qui ne permet pas de rejouer.
    const sealed: PoolParticipant[] = [
      { id: 'p1', weight: 3 },
      { id: 'p2', weight: 1 },
      { id: 'p3', weight: 1 },
      { id: 'p4', weight: 1 },
    ];
    const sealedReveal: DrawInput = { ...single, participants: sealed };
    const winner = computeWinners(sealedReveal).winners[0]!.participantId;
    const res = verifyDraw({
      ...buildVerifyInput(),
      reveal: sealedReveal,
      seal: { ...computePoolSeal(sealed), sealRound: REAL_BEACON.round - 1 },
      claimedWinners: [{ rank: 1, participantId: winner }],
      weightingMode: 'weighted',
      referralBonusEntries: 1,
      designations: [{ order: 0, rank: 1, participantId: winner, status: 'pending' }],
    });

    expect(res.redrawsInconclusive).toBe(true);
    expect(res.redrawCount).toBe(0);
    expect(res.ok).toBe(false);
  });
});

/**
 * Les gagnants affichés sont ceux de la chaîne vérifiée.
 *
 * Avec une chaîne, le verdict la rejoue ; la page, elle, affiche `claimedWinners` (le
 * `bundle.winners` du serveur). Tant que rien ne les confrontait, un badge « vérifié » pouvait
 * côtoyer un gagnant que la chaîne ne désigne pas — reproduit par le scan : chaîne honnête,
 * `winners` réécrit vers un perdant, verdict entièrement vert.
 */
describe('verifyDraw — gagnants annoncés liés à la chaîne', () => {
  const single: DrawInput = { ...reveal, winnersCount: 1 };
  const trueWinner = computeWinners(single).winners[0]!.participantId;
  const fake = participants.find((p) => p.id !== trueWinner)!.id;
  const chainInput = (claimed: string[]): VerifyInput => ({
    ...buildVerifyInput(),
    reveal: single,
    claimedWinners: claimed.map((participantId) => ({ rank: 1, participantId })),
    weightingMode: 'equal',
    referrals: participants.map((p) => ({
      id: p.id,
      referredByParticipantId: null,
      suppliedEntries: 1,
    })),
    designations: [{ order: 0, rank: 1, participantId: trueWinner, status: 'pending' }],
  });

  it('témoin : chaîne honnête et gagnants annoncés concordants → conforme', () => {
    expect(verifyDraw(chainInput([trueWinner])).ok).toBe(true);
  });

  it('BLOQUANT : un gagnant affiché qui n’est pas celui de la chaîne invalide le verdict', () => {
    const res = verifyDraw(chainInput([fake]));
    expect(res.winnersOk).toBe(false);
    expect(res.ok).toBe(false);
    // La chaîne, elle, est intacte : l'échec porte bien sur la liste affichée.
    expect(res.redrawsOk).toBe(true);
  });

  it('BLOQUANT : un gagnant affiché en trop, ou manquant, invalide le verdict', () => {
    expect(verifyDraw(chainInput([trueWinner, fake])).ok).toBe(false);
    expect(verifyDraw(chainInput([])).ok).toBe(false);
  });

  it('BLOQUANT : un gagnant forfaité encore affiché invalide le verdict', () => {
    const res = verifyDraw({
      ...chainInput([trueWinner]),
      designations: [{ order: 0, rank: 1, participantId: trueWinner, status: 'forfeited' }],
    });
    expect(res.winnersOk).toBe(false);
  });

  /*
   * Reproduction de l'audit : engagement, graine, beacon, sceau et désignation initiale honnêtes ;
   * la désignation initiale est forfaitée, et une désignation forgée reprend son ordre pour
   * nommer un participant que rien n'a désigné. Elle était classée initiale, donc jamais rejouée,
   * et les sept contrôles passaient.
   */
  it('BLOQUANT : une désignation forgée qui reprend l’ordre de la désignation initiale échoue', () => {
    const aliases: Array<[number, number]> = [
      [0, 0],
      [Number.NaN, Number.NaN],
      [0, -0],
    ];
    for (const [a, b] of aliases) {
      const res = verifyDraw({
        ...chainInput([fake]),
        designations: [
          { order: a, rank: 1, participantId: trueWinner, status: 'forfeited' },
          { order: b, rank: 1, participantId: fake, status: 'pending' },
        ],
      });
      expect(res.winnersOk).toBe(false);
      expect(res.redrawsOk).toBe(false);
      expect(res.ok).toBe(false);
    }
  });
});
