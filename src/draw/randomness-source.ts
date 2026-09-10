import { sha256Hex } from './hash.js';

/**
 * Source d'aléa branchable du moteur de tirage. Une implémentation réelle
 * (`DrandSource`, incrément ultérieur) interrogera le réseau drand ; le cœur ne
 * connaît que ce contrat.
 */
export interface RandomnessSource {
  /** Round déterministe associé à une date (fenêtre temporelle du tirage). */
  roundAt(date: Date): number;
  /** Valeur d'aléa signée du round, disponible **après** l'échéance du round. */
  getRandomness(round: number): Promise<string>;
}

export interface FakeRandomnessSourceOptions {
  /** Durée d'une fenêtre de round, en secondes (défaut : 30, comme drand v1). */
  periodSeconds?: number;
}

/**
 * Implémentation **déterministe** de test : aucun réseau. `roundAt` mappe le
 * temps sur des fenêtres fixes ; `getRandomness` dérive une valeur reproductible
 * du round. Sert les tests et le développement sans dépendre de drand.
 */
export class FakeRandomnessSource implements RandomnessSource {
  private readonly periodSeconds: number;

  constructor(options: FakeRandomnessSourceOptions = {}) {
    this.periodSeconds = options.periodSeconds ?? 30;
  }

  roundAt(date: Date): number {
    return Math.floor(date.getTime() / 1000 / this.periodSeconds);
  }

  getRandomness(round: number): Promise<string> {
    return Promise.resolve(sha256Hex(`fake-drand|${round}`));
  }
}
