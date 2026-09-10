import { describe, expect, it } from 'vitest';
import { buildWitnessPayload, witnessPayloadSha256, witnessPhaseOf } from './witness-record.js';
import { sha256Hex } from './hash.js';

const commitment = {
  tenant: 'acme',
  giveaway: 'promo-ete',
  serverSeedHash: 'a'.repeat(64),
  drandRound: 1_234_587,
};

const sealed = {
  ...commitment,
  seal: {
    merkleRoot: 'b'.repeat(64),
    poolSize: 4210,
    sealRound: 1_234_567,
    sealedAt: '2026-08-05T18:00:00.000Z',
  },
};

describe('buildWitnessPayload', () => {
  // La charge publiée est ce qu'un tiers rehache pour vérifier l'ancre. Si l'ordre des clés
  // dépendait de l'ordre d'insertion, deux exports de la même donnée donneraient deux empreintes
  // et une vérification honnête échouerait.
  it('BLOQUANT : ordre des clés fixe, indépendant de l’ordre de construction', () => {
    const direct = buildWitnessPayload(commitment);
    const reversed = buildWitnessPayload({
      drandRound: commitment.drandRound,
      serverSeedHash: commitment.serverSeedHash,
      giveaway: commitment.giveaway,
      tenant: commitment.tenant,
    });
    expect(reversed).toBe(direct);
  });

  it('rend un JSON lisible terminé par un saut de ligne', () => {
    const payload = buildWitnessPayload(commitment);
    expect(payload.endsWith('\n')).toBe(true);
    expect(JSON.parse(payload)).toEqual({
      tenant: 'acme',
      giveaway: 'promo-ete',
      serverSeedHash: 'a'.repeat(64),
      drandRound: 1_234_587,
    });
  });

  it('inclut le sceau quand il est fourni, sans réordonner le reste', () => {
    const parsed = JSON.parse(buildWitnessPayload(sealed));
    expect(parsed.seal).toEqual({
      merkleRoot: 'b'.repeat(64),
      poolSize: 4210,
      sealRound: 1_234_567,
      sealedAt: '2026-08-05T18:00:00.000Z',
    });
    expect(Object.keys(parsed)).toEqual([
      'tenant',
      'giveaway',
      'serverSeedHash',
      'drandRound',
      'seal',
    ]);
  });

  it('nomme la phase d’après la présence du sceau', () => {
    expect(witnessPhaseOf(commitment)).toBe('commitment');
    expect(witnessPhaseOf(sealed)).toBe('seal');
  });
});

describe('witnessPayloadSha256', () => {
  // C'est l'empreinte que la plateforme conserve (`seal_witness.payload_sha256`) et qu'un tiers
  // doit pouvoir recalculer à partir des seules valeurs publiques. Sans cette égalité, un
  // visiteur peut télécharger le reçu d'ancrage mais rien ne lui dit que ce qui a été ancré est
  // ce qu'il est en train de lire.
  it('BLOQUANT : recalculable à partir des seules valeurs publiques', () => {
    expect(witnessPayloadSha256(sealed)).toBe(sha256Hex(buildWitnessPayload(sealed)));
  });

  // Le sceau fait partie de la charge : un ancrage de phase « commitment » et un ancrage de
  // phase « seal » du même giveaway ne doivent jamais partager une empreinte, sinon le reçu de
  // l'un vaudrait preuve pour l'autre.
  it('sépare les deux phases', () => {
    expect(witnessPayloadSha256(commitment)).not.toBe(witnessPayloadSha256(sealed));
  });

  // La moindre altération d'une valeur publiée doit casser l'égalité — c'est tout l'intérêt.
  it('BLOQUANT : change si une seule valeur publiée change', () => {
    const tampered = { ...sealed, seal: { ...sealed.seal, sealRound: sealed.seal.sealRound + 1 } };
    expect(witnessPayloadSha256(tampered)).not.toBe(witnessPayloadSha256(sealed));
  });
});

/**
 * BLOQUANT — invariant du lot multilingue.
 *
 * Le contenu **lisible** d'un giveaway (titre, description, libellés de lots) est traduisible, et
 * les traductions se modifient tant que le giveaway est en brouillon. Rien de tout cela ne doit
 * entrer dans la charge canonique publiée aux témoins : si c'était le cas, traduire un giveaway
 * ferait diverger l'empreinte déjà ancrée, et la publication honnête d'hier serait contredite par
 * une correction de faute de frappe d'aujourd'hui.
 *
 * La charge ne porte donc que ce qui **détermine le tirage** : l'espace, l'identifiant du
 * giveaway, l'empreinte de la graine, le round drand, et le sceau de la liste. Ce test le fige.
 */
describe('buildWitnessPayload — indépendance au contenu traduisible', () => {
  it('BLOQUANT : ne porte que les valeurs du tirage, jamais le contenu lisible', () => {
    const payload = buildWitnessPayload({
      tenant: 'acme',
      giveaway: 'grand-jeu',
      serverSeedHash: 'a'.repeat(64),
      drandRound: 42,
    });

    expect(Object.keys(JSON.parse(payload))).toEqual([
      'tenant',
      'giveaway',
      'serverSeedHash',
      'drandRound',
    ]);
  });

  it('BLOQUANT : l’empreinte est insensible à un titre ou à une traduction', async () => {
    const record = {
      tenant: 'acme',
      giveaway: 'grand-jeu',
      serverSeedHash: 'b'.repeat(64),
      drandRound: 7,
    };
    // Une charge construite avec du contenu lisible en plus doit produire la **même** empreinte :
    // les champs surnuméraires ne sont pas repris, donc n'ancrent rien.
    const withContent = { ...record, title: 'Grand jeu', description: 'Trois lots' } as never;

    expect(await witnessPayloadSha256(record)).toBe(await witnessPayloadSha256(withContent));
  });
});
