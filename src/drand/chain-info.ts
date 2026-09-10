/** Paramètres publics d'un réseau (chain) drand. */
export interface DrandChainInfo {
  /** Clé publique du réseau, hex (G2, 96 octets pour quicknet). */
  publicKey: string;
  /** Durée d'un round, en secondes. */
  period: number;
  /** Instant du round 1, epoch en secondes. */
  genesisTime: number;
  /** Chain hash — identifiant du réseau. */
  hash: string;
  /** Schéma de signature (ex. `bls-unchained-g1-rfc9380`). */
  schemeID: string;
}

/** Un beacon drand (valeur d'aléa signée d'un round). */
export interface DrandBeacon {
  round: number;
  /** hex = sha256(signature). Sert de `drandValue` au moteur. */
  randomness: string;
  /** hex (G1, 48 octets pour quicknet). */
  signature: string;
}

/**
 * Réseau **quicknet** de la League of Entropy : unchained, rapide (period 3 s),
 * signatures G1 / clé G2, hash-to-curve RFC 9380. Paramètres publics figés.
 */
export const QUICKNET_CHAIN_INFO: DrandChainInfo = {
  publicKey:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  period: 3,
  genesisTime: 1692803367,
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  schemeID: 'bls-unchained-g1-rfc9380',
};
