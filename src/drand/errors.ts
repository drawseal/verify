/**
 * Erreur du client drand. Levée par `DrandSource` sur échec réseau, réponse HTTP
 * non-2xx, JSON invalide, round incohérent ou **beacon non vérifié** (signature
 * BLS invalide). Un beacon non vérifié n'est jamais silencieusement consommé.
 */
export class DrandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrandError';
    Object.setPrototypeOf(this, DrandError.prototype);
  }
}
