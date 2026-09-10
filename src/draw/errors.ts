/**
 * Erreur du domaine « moteur de tirage ». Levée uniquement sur une **entrée
 * malformée** (pool vide, poids invalide, `winnersCount` hors bornes, `id`
 * dupliqués…). Un simple **écart de vérification** n'est jamais une exception :
 * c'est un résultat auditable renvoyé par `verifyDraw`.
 */
export class DrawEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawEngineError';
    // Restaure la chaîne de prototype (transpilation ES5 / `extends Error`).
    Object.setPrototypeOf(this, DrawEngineError.prototype);
  }
}
