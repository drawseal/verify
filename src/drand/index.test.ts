import { describe, it, expect } from 'vitest';
import {
  DrandSource,
  verifyBeacon,
  computeWinners,
  commitServerSeed,
  verifyDraw,
  computePoolSeal,
} from '../index.js';
import type { DrandBeacon } from '../index.js';

const REAL: DrandBeacon = {
  round: 1_000_000,
  randomness: 'b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
  signature:
    '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
};

// Fumée d'intégration : drand (fetch mocké, beacon vérifié) → moteur de tirage →
// vérification, depuis la seule surface publique du package.
describe('drand → moteur de tirage (bout en bout)', () => {
  it('la randomness vérifiée alimente computeWinners puis verifyDraw', async () => {
    expect(verifyBeacon(REAL)).toBe(true);

    const src = new DrandSource({
      fetchImpl: (async () =>
        ({ ok: true, status: 200, json: async () => REAL }) as unknown as Response) as typeof fetch,
    });
    const drandValue = await src.getRandomness(1_000_000);

    const reveal = {
      serverSeed: 'seed',
      drandValue,
      winnersCount: 1,
      participants: [
        { id: 'a', weight: 1 },
        { id: 'b', weight: 1 },
      ],
    };
    const outcome = computeWinners(reveal);
    const result = verifyDraw({
      commitment: { serverSeedHash: commitServerSeed(reveal.serverSeed), drandRound: 1_000_000 },
      // Scellé pendant le round précédent : le hasard employé n'existait pas encore.
      seal: { ...computePoolSeal(reveal.participants), sealRound: 999_999 },
      // Le beacon lui-même, et pas seulement sa randomness : `verifyDraw` établit qu'il est
      // authentique **et** qu'il est celui engagé.
      beacon: REAL,
      reveal,
      claimedWinners: outcome.winners.map((w) => ({
        rank: w.rank,
        participantId: w.participantId,
      })),
    });
    expect(result.ok).toBe(true);
  });
});
