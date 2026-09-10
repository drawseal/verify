import { describe, expect, it } from 'vitest';
import {
  canonicalEntry,
  computePoolSeal,
  poolInclusionProof,
  poolLeaves,
  poolMatchesSeal,
  sealPrecedesRandomness,
  verifyPoolInclusion,
} from './pool-seal.js';
import { hashLeaf } from './merkle.js';
import { DrawEngineError } from './errors.js';
import type { PoolParticipant } from './pool.js';

function pool(n: number, weight = 1): PoolParticipant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    weight,
  }));
}

describe('canonicalEntry / poolLeaves', () => {
  it('sérialise une entrée en `id:weight`', () => {
    expect(canonicalEntry({ id: 'abc', weight: 3 })).toBe('abc:3');
  });

  it('produit les feuilles dans l’ordre canonique, pas l’ordre d’entrée', () => {
    const shuffled: PoolParticipant[] = [
      { id: 'c', weight: 1 },
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ];
    expect(poolLeaves(shuffled)).toEqual([hashLeaf('a:1'), hashLeaf('b:1'), hashLeaf('c:1')]);
  });
});

describe('computePoolSeal', () => {
  // Sans cette propriété, la racine dépendrait d'un détail de requête SQL et une vérification
  // honnête pourrait échouer.
  it('BLOQUANT : le sceau est indépendant de l’ordre d’insertion', () => {
    const ordered = pool(9);
    const shuffled = [...ordered].reverse();
    expect(computePoolSeal(shuffled)).toEqual(computePoolSeal(ordered));
  });

  it('scelle la taille à côté de la racine', () => {
    expect(computePoolSeal(pool(5)).poolSize).toBe(5);
  });

  it('distingue deux pools de même taille aux poids différents', () => {
    expect(computePoolSeal(pool(4, 1)).merkleRoot).not.toBe(computePoolSeal(pool(4, 2)).merkleRoot);
  });

  it('distingue deux pools de tailles différentes', () => {
    expect(computePoolSeal(pool(4)).merkleRoot).not.toBe(computePoolSeal(pool(5)).merkleRoot);
  });

  it('refuse un pool vide', () => {
    expect(() => computePoolSeal([])).toThrow(DrawEngineError);
  });
});

describe('poolMatchesSeal', () => {
  it('accepte le pool exact qui a été scellé, dans n’importe quel ordre', () => {
    const original = pool(7);
    const seal = computePoolSeal(original);
    expect(poolMatchesSeal(original, seal)).toBe(true);
    expect(poolMatchesSeal([...original].reverse(), seal)).toBe(true);
  });

  // C'est l'attaque que le sceau existe pour fermer : glisser une entrée après avoir vu le tirage.
  it('BLOQUANT : refuse un pool auquel une entrée a été ajoutée', () => {
    const seal = computePoolSeal(pool(7));
    expect(poolMatchesSeal([...pool(7), { id: 'intrus', weight: 1 }], seal)).toBe(false);
  });

  it('BLOQUANT : refuse un pool auquel une entrée a été retirée', () => {
    const seal = computePoolSeal(pool(7));
    expect(poolMatchesSeal(pool(7).slice(1), seal)).toBe(false);
  });

  it('BLOQUANT : refuse un pool dont un poids a été modifié', () => {
    const seal = computePoolSeal(pool(7));
    const tampered = pool(7).map((p, i) => (i === 3 ? { ...p, weight: 99 } : p));
    expect(poolMatchesSeal(tampered, seal)).toBe(false);
  });

  it('BLOQUANT : refuse un pool où un identifiant a été substitué à taille constante', () => {
    const seal = computePoolSeal(pool(7));
    const swapped = pool(7).map((p, i) => (i === 2 ? { id: 'complice', weight: 1 } : p));
    expect(poolMatchesSeal(swapped, seal)).toBe(false);
  });

  it('refuse un pool vide face à un sceau', () => {
    expect(poolMatchesSeal([], computePoolSeal(pool(3)))).toBe(false);
  });
});

describe('sealPrecedesRandomness', () => {
  // « Strictement avant » et non « au plus tard en même temps » : un scellement dans la même
  // fenêtre de round laisserait planer le doute qu'il ait eu lieu après publication du beacon.
  it('BLOQUANT : exige un round de scellement strictement antérieur', () => {
    expect(sealPrecedesRandomness(100, 101)).toBe(true);
    expect(sealPrecedesRandomness(100, 100)).toBe(false);
    expect(sealPrecedesRandomness(101, 100)).toBe(false);
  });

  it('refuse des valeurs non entières', () => {
    expect(sealPrecedesRandomness(1.5, 100)).toBe(false);
    expect(sealPrecedesRandomness(1, Number.NaN)).toBe(false);
  });
});

describe('poolInclusionProof / verifyPoolInclusion', () => {
  it('un participant vérifie son inclusion sans la liste entière', () => {
    const entries = pool(33);
    const seal = computePoolSeal(entries);
    for (const participant of entries) {
      const { proof } = poolInclusionProof(entries, participant.id);
      expect(verifyPoolInclusion(participant, proof, seal)).toBe(true);
    }
  });

  it('la feuille rendue est celle du participant', () => {
    const entries = pool(4);
    expect(poolInclusionProof(entries, 'p002').leaf).toBe(hashLeaf('p002:1'));
  });

  // Le pendant de la garantie : la plateforme ne peut pas fabriquer une appartenance.
  it('BLOQUANT : une preuve ne vaut pas pour un autre participant', () => {
    const entries = pool(8);
    const seal = computePoolSeal(entries);
    const { proof } = poolInclusionProof(entries, 'p003');
    expect(verifyPoolInclusion({ id: 'p004', weight: 1 }, proof, seal)).toBe(false);
  });

  it('BLOQUANT : une preuve ne vaut pas si le poids annoncé diffère', () => {
    const entries = pool(8);
    const seal = computePoolSeal(entries);
    const { proof } = poolInclusionProof(entries, 'p003');
    expect(verifyPoolInclusion({ id: 'p003', weight: 5 }, proof, seal)).toBe(false);
  });

  it('refuse de produire une preuve pour un absent', () => {
    expect(() => poolInclusionProof(pool(5), 'fantome')).toThrow(DrawEngineError);
  });
});
