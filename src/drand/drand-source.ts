import { DrandError } from './errors.js';
import { QUICKNET_CHAIN_INFO } from './chain-info.js';
import { verifyBeacon } from './verify-beacon.js';
import type { DrandBeacon, DrandChainInfo } from './chain-info.js';
import type { RandomnessSource } from '../draw/randomness-source.js';

const DEFAULT_BASE_URL = 'https://api.drand.sh';

export interface DrandSourceOptions {
  chainInfo?: DrandChainInfo;
  baseUrl?: string;
  /** Implémentation `fetch` (défaut : `globalThis.fetch`). Injectable en test. */
  fetchImpl?: typeof fetch;
}

/**
 * Client drand **réseau** implémentant `RandomnessSource`. `roundAt` déduit le
 * round d'une date ; `getRandomness` récupère le beacon par HTTP, **le vérifie**
 * (BLS) et renvoie `randomness`. Ne renvoie jamais un beacon non vérifié.
 *
 * Client « une requête, vérifiée » : retry/timeout/fallback sont la
 * responsabilité de l'appelant (worker d'orchestration), pas de ce client pur.
 */
export class DrandSource implements RandomnessSource {
  private readonly chainInfo: DrandChainInfo;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DrandSourceOptions = {}) {
    this.chainInfo = options.chainInfo ?? QUICKNET_CHAIN_INFO;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new DrandError('aucune implémentation fetch disponible (fournir options.fetchImpl)');
    }
    this.fetchImpl = fetchImpl;
  }

  roundAt(date: Date): number {
    const epoch = Math.floor(date.getTime() / 1000);
    const elapsed = epoch - this.chainInfo.genesisTime;
    if (elapsed < 0) {
      return 1;
    }
    return Math.floor(elapsed / this.chainInfo.period) + 1;
  }

  async getRandomness(round: number): Promise<string> {
    const beacon = await this.getBeacon(round);
    return beacon.randomness;
  }

  /**
   * Récupère le **beacon complet vérifié** (`round`, `randomness`, `signature`)
   * d'un round. La signature permet une vérification BLS **hors ligne** ultérieure
   * (page publique de vérification). Lève `DrandError` sur toute anomalie ou
   * vérification échouée — jamais de beacon non vérifié renvoyé.
   */
  async getBeacon(round: number): Promise<DrandBeacon> {
    const url = `${this.baseUrl}/${this.chainInfo.hash}/public/${round}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (cause) {
      throw new DrandError(`échec réseau drand (round ${round}) : ${describe(cause)}`);
    }

    if (!res.ok) {
      throw new DrandError(`réponse drand non-2xx (round ${round}) : HTTP ${res.status}`);
    }

    let beacon: DrandBeacon;
    try {
      beacon = (await res.json()) as DrandBeacon;
    } catch (cause) {
      throw new DrandError(`JSON drand invalide (round ${round}) : ${describe(cause)}`);
    }

    if (
      typeof beacon?.randomness !== 'string' ||
      typeof beacon?.signature !== 'string' ||
      beacon?.round !== round
    ) {
      throw new DrandError(`beacon drand incohérent pour le round ${round}`);
    }

    if (!verifyBeacon(beacon, this.chainInfo)) {
      throw new DrandError(`beacon drand non vérifié (signature BLS invalide, round ${round})`);
    }

    return beacon;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
