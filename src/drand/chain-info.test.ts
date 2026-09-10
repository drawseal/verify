import { describe, it, expect } from 'vitest';
import { QUICKNET_CHAIN_INFO } from './chain-info.js';

describe('QUICKNET_CHAIN_INFO', () => {
  it('porte les paramètres publics du réseau quicknet', () => {
    expect(QUICKNET_CHAIN_INFO.hash).toBe(
      '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
    );
    expect(QUICKNET_CHAIN_INFO.period).toBe(3);
    expect(QUICKNET_CHAIN_INFO.genesisTime).toBe(1692803367);
    expect(QUICKNET_CHAIN_INFO.schemeID).toBe('bls-unchained-g1-rfc9380');
    expect(QUICKNET_CHAIN_INFO.publicKey).toHaveLength(192); // G2 96 octets → 192 hex
  });
});
