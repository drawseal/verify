import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash.js';
import {
  hashLeaf,
  hashNode,
  merkleProof,
  merkleRoot,
  verifyMerkleProof,
  type MerkleProofStep,
} from './merkle.js';
import { DrawEngineError } from './errors.js';

/** Feuilles d'un pool de `n` participants, dans l'ordre canonique. */
function leavesOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => hashLeaf(`p${String(i).padStart(3, '0')}:1`));
}

describe('hashLeaf / hashNode', () => {
  it('hashe une feuille avec le préfixe de domaine', () => {
    expect(hashLeaf('a:1')).toBe(sha256Hex('leaf:a:1'));
  });

  it('hashe un nœud avec le préfixe de domaine, ordre significatif', () => {
    expect(hashNode('aa', 'bb')).toBe(sha256Hex('node:aabb'));
    expect(hashNode('aa', 'bb')).not.toBe(hashNode('bb', 'aa'));
  });

  // Sans préfixes distincts, l'empreinte d'un nœud interne pourrait être présentée comme une
  // feuille : une preuve d'inclusion serait alors fabricable pour un participant absent.
  it('BLOQUANT : une feuille et un nœud de même contenu ont des empreintes différentes', () => {
    expect(hashLeaf('aabb')).not.toBe(hashNode('aa', 'bb'));
  });
});

describe('merkleRoot', () => {
  it('feuille unique : la racine est la feuille', () => {
    const [only] = leavesOf(1);
    expect(merkleRoot([only as string])).toBe(only);
  });

  it('deux feuilles : la racine est le nœud parent', () => {
    const leaves = leavesOf(2);
    expect(merkleRoot(leaves)).toBe(hashNode(leaves[0] as string, leaves[1] as string));
  });

  // Le dernier nœud d'un niveau impair est promu tel quel. Le dupliquer — choix historique de
  // Bitcoin — permettrait à deux listes différentes de produire la même racine.
  it('BLOQUANT : un niveau impair promeut son dernier nœud sans le dupliquer', () => {
    const [a, b, c] = leavesOf(3) as [string, string, string];
    expect(merkleRoot([a, b, c])).toBe(hashNode(hashNode(a, b), c));
    // La variante « duplication du dernier » donnerait ceci — elle doit différer.
    expect(merkleRoot([a, b, c])).not.toBe(hashNode(hashNode(a, b), hashNode(c, c)));
  });

  it('est déterministe et distingue deux listes différentes', () => {
    expect(merkleRoot(leavesOf(7))).toBe(merkleRoot(leavesOf(7)));
    expect(merkleRoot(leavesOf(7))).not.toBe(merkleRoot(leavesOf(8)));
  });

  it('dépend de l’ordre des feuilles (l’ordre canonique est donc imposé en amont)', () => {
    const leaves = leavesOf(4);
    const swapped = [leaves[1], leaves[0], leaves[2], leaves[3]] as string[];
    expect(merkleRoot(swapped)).not.toBe(merkleRoot(leaves));
  });

  it('refuse un arbre vide plutôt que d’inventer une racine conventionnelle', () => {
    expect(() => merkleRoot([])).toThrow(DrawEngineError);
  });
});

describe('merkleProof / verifyMerkleProof', () => {
  // Tailles couvrant les arbres pleins et déséquilibrés, y compris le cas dégénéré à 1 feuille.
  for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 33]) {
    it(`toute feuille d’un pool de ${size} se prouve jusqu’à la racine`, () => {
      const leaves = leavesOf(size);
      const root = merkleRoot(leaves);
      for (let i = 0; i < size; i += 1) {
        expect(verifyMerkleProof(leaves[i] as string, merkleProof(leaves, i), root)).toBe(true);
      }
    });
  }

  it('une preuve de feuille unique est vide (la feuille est la racine)', () => {
    const leaves = leavesOf(1);
    expect(merkleProof(leaves, 0)).toEqual([]);
  });

  // Le cœur de la garantie : la plateforme ne peut pas fabriquer d'appartenance.
  it('BLOQUANT : aucune preuve ne valide un identifiant absent de la liste', () => {
    const leaves = leavesOf(8);
    const root = merkleRoot(leaves);
    const absent = hashLeaf('intrus:1');
    // Le chemin d'une feuille légitime ne sert à rien pour une autre.
    for (let i = 0; i < leaves.length; i += 1) {
      expect(verifyMerkleProof(absent, merkleProof(leaves, i), root)).toBe(false);
    }
  });

  it('BLOQUANT : une preuve d’un autre pool ne valide pas contre cette racine', () => {
    const mine = leavesOf(8);
    const other = leavesOf(9);
    expect(verifyMerkleProof(mine[0] as string, merkleProof(other, 0), merkleRoot(mine))).toBe(
      false,
    );
  });

  it('rejette une preuve dont une étape a été altérée', () => {
    const leaves = leavesOf(8);
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, 3);
    const tampered = proof.map((s, i) => (i === 0 ? { ...s, sibling: hashLeaf('x:1') } : s));
    expect(verifyMerkleProof(leaves[3] as string, tampered, root)).toBe(false);
  });

  it('rejette une preuve dont l’orientation a été inversée', () => {
    const leaves = leavesOf(8);
    const root = merkleRoot(leaves);
    const flipped = merkleProof(leaves, 3).map((s) => ({
      ...s,
      position: s.position === 'left' ? ('right' as const) : ('left' as const),
    }));
    expect(verifyMerkleProof(leaves[3] as string, flipped, root)).toBe(false);
  });

  // Deviner l'intention d'une preuve malformée reviendrait à l'accepter.
  it('rejette une étape dont l’orientation est inconnue', () => {
    const leaves = leavesOf(4);
    const bogus = [{ sibling: leaves[1], position: 'middle' }] as unknown as MerkleProofStep[];
    expect(verifyMerkleProof(leaves[0] as string, bogus, merkleRoot(leaves))).toBe(false);
  });

  it('refuse un index hors bornes', () => {
    const leaves = leavesOf(4);
    expect(() => merkleProof(leaves, -1)).toThrow(DrawEngineError);
    expect(() => merkleProof(leaves, 4)).toThrow(DrawEngineError);
    expect(() => merkleProof(leaves, 1.5)).toThrow(DrawEngineError);
  });

  it('refuse un arbre vide', () => {
    expect(() => merkleProof([], 0)).toThrow(DrawEngineError);
  });
});
