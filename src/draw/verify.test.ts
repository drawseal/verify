import { describe, it, expect } from 'vitest';
import { verifyDraw } from './verify.js';
import { computeWinners, commitServerSeed } from './compute-winners.js';
import { computePoolSeal } from './pool-seal.js';
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
