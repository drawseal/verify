import { describe, it, expect, vi } from 'vitest';
import { DrandSource } from './drand-source.js';
import { DrandError } from './errors.js';
import { QUICKNET_CHAIN_INFO } from './chain-info.js';
import type { DrandBeacon } from './chain-info.js';

const REAL: DrandBeacon = {
  round: 1_000_000,
  randomness: 'b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
  signature:
    '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
};

/** fetch factice renvoyant un corps JSON avec un statut donné. */
function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({ ok, status, json: async () => body }) as unknown as Response) as typeof fetch;
}

describe('DrandSource.roundAt', () => {
  const src = new DrandSource({ fetchImpl: fakeFetch(REAL) });

  it('round 1 au genesis, +1 par période', () => {
    const genesis = QUICKNET_CHAIN_INFO.genesisTime;
    expect(src.roundAt(new Date(genesis * 1000))).toBe(1);
    expect(src.roundAt(new Date((genesis + QUICKNET_CHAIN_INFO.period) * 1000))).toBe(2);
    expect(src.roundAt(new Date((genesis + 2 * QUICKNET_CHAIN_INFO.period) * 1000))).toBe(3);
  });

  it('est borné à ≥ 1 avant le genesis', () => {
    expect(src.roundAt(new Date((QUICKNET_CHAIN_INFO.genesisTime - 100) * 1000))).toBe(1);
  });

  it('est monotone croissant', () => {
    const t0 = new Date(2_000_000_000 * 1000);
    const t1 = new Date((2_000_000_000 + 60) * 1000);
    expect(src.roundAt(t1)).toBeGreaterThan(src.roundAt(t0));
  });
});

describe('DrandSource.getRandomness', () => {
  it('renvoie randomness pour un beacon vérifié', async () => {
    const src = new DrandSource({ fetchImpl: fakeFetch(REAL) });
    expect(await src.getRandomness(1_000_000)).toBe(REAL.randomness);
  });

  it('getBeacon renvoie le beacon complet vérifié (avec signature)', async () => {
    const src = new DrandSource({ fetchImpl: fakeFetch(REAL) });
    expect(await src.getBeacon(1_000_000)).toEqual(REAL);
  });

  it('getBeacon lève DrandError sur un beacon falsifié', async () => {
    const src = new DrandSource({ fetchImpl: fakeFetch({ ...REAL, randomness: 'f'.repeat(64) }) });
    await expect(src.getBeacon(1_000_000)).rejects.toBeInstanceOf(DrandError);
  });

  it('lève DrandError sur HTTP non-2xx', async () => {
    const src = new DrandSource({ fetchImpl: fakeFetch({}, false, 500) });
    await expect(src.getRandomness(1_000_000)).rejects.toBeInstanceOf(DrandError);
  });

  it('lève DrandError si le round renvoyé diffère du round demandé', async () => {
    const src = new DrandSource({ fetchImpl: fakeFetch(REAL) });
    await expect(src.getRandomness(999_999)).rejects.toBeInstanceOf(DrandError);
  });

  it('lève DrandError sur un beacon falsifié (BLS invalide)', async () => {
    const forged = { ...REAL, randomness: 'f'.repeat(64) };
    const src = new DrandSource({ fetchImpl: fakeFetch(forged) });
    await expect(src.getRandomness(1_000_000)).rejects.toBeInstanceOf(DrandError);
  });

  it('lève DrandError si fetch rejette (panne réseau)', async () => {
    const src = new DrandSource({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    await expect(src.getRandomness(1_000_000)).rejects.toBeInstanceOf(DrandError);
  });

  it('construit l’URL sur le chain hash et le round', async () => {
    let seenUrl = '';
    const spy: typeof fetch = (async (url: string) => {
      seenUrl = url;
      return { ok: true, status: 200, json: async () => REAL } as unknown as Response;
    }) as typeof fetch;
    const src = new DrandSource({ fetchImpl: spy, baseUrl: 'https://drand.example/' });
    await src.getRandomness(1_000_000);
    expect(seenUrl).toBe(`https://drand.example/${QUICKNET_CHAIN_INFO.hash}/public/1000000`);
  });
});

describe('DrandSource — construction', () => {
  it('lève DrandError si aucun fetch n’est disponible', () => {
    vi.stubGlobal('fetch', undefined);
    try {
      expect(() => new DrandSource()).toThrow(DrandError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
