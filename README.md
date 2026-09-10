# DrawSeal — vérificateur

Rejoue un tirage DrawSeal à partir de son document de vérification public et dit s'il est
conforme. **C'est le code qui tire.** Pas une réimplémentation, pas une traduction : le moteur
qui désigne les gagnants en production est ce paquet, et vous en lisez la source.

[![Licence](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](./LICENSE)

---

## Pourquoi ce dépôt existe

Une vérification faite par la maison qui organise le tirage n'établit rien. Elle prouve que le
dossier est **cohérent** — or c'est nous qui l'avons entièrement écrit. Ce qu'elle n'établit
pas, c'est l'**antériorité** : qu'au moment où la liste a été figée, personne ne pouvait encore
savoir qui allait gagner.

Ce dépôt sert à ce que vous n'ayez pas à nous croire. Vous prenez le document publié, vous
lancez ce code sur votre machine, et vous obtenez un verdict que nous n'avons pas calculé.

## Ce que le vérificateur contrôle

Sept contrôles, tous nécessaires, aucun suffisant seul. `ok` ne vaut `true` que si les sept le sont.

| Contrôle                                         | Ce qu'il établit                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seedHashOk`                                     | `sha256(serverSeed)` égale l'empreinte **publiée avant le tirage** : la graine révélée est bien celle sur laquelle la plateforme s'était engagée.                                                               |
| `poolSealOk`                                     | La racine de Merkle recalculée sur la liste révélée égale celle scellée, taille comprise : la liste tirée est celle figée à la clôture des inscriptions. Aucun participant ajouté, retiré ni réordonné depuis.  |
| `sealOrderOk`                                    | La liste a été scellée pendant une fenêtre de round drand **antérieure** à celle du hasard employé. Au moment du scellement, ce hasard n'existait pas et n'était pas connaissable.                              |
| `beaconOk`                                       | Le beacon drand est authentique (signature BLS valide sous la clé publique du réseau) **et** c'est bien celui engagé — même round, même randomness. Les trois conditions sont indissociables : voir ci-dessous. |
| `winnersOk`                                      | Les gagnants recalculés, rang à rang, sont ceux annoncés.                                                                                                                                                       |
| `redrawsOk`                                      | Chaque remplaçant, en cas de lot non réclamé, se recalcule à partir des seules valeurs publiques.                                                                                                               |
| `recomputedMerkleRoot` / `recomputedFingerprint` | Les valeurs recalculées, à confronter vous-même à celles publiées et aux témoins externes.                                                                                                                      |

### Pourquoi une signature BLS valide ne suffit pas

C'est le point le plus subtil du dispositif, et celui qu'une vérification naïve rate.

Une signature drand valide établit que le beacon vient bien du réseau drand — **pas** qu'il
s'agit de celui sur lequel la plateforme s'était engagée. Sans la double égalité round + aléa,
un exploitant disposant d'un accès en écriture à la base laisse `serverSeed` et son empreinte
intacts (l'engagement témoin reste donc valide) et substitue l'aléa par celui de n'importe quel
autre round de l'historique drand, choisi **après coup** pour que le calcul désigne le
participant voulu. Tous les autres contrôles passeraient.

C'est l'engagement sur le **numéro de round**, publié avant le scellement, qui interdit ce
choix. `beaconOk` est ce qui le fait respecter.

## Le vérificateur ne ment jamais, même en retard

Un vérificateur publié qui prend du retard sur le moteur est **pire que pas de vérificateur du
tout** : confronté à un tirage produit par une règle qu'il ne connaît pas, il recalculerait un
autre gagnant et conclurait « non conforme ». Il fabriquerait une accusation de fraude contre un
tirage honnête, avec notre propre code à l'appui.

D'où la règle, appliquée avant tout calcul : **face à un document produit par une version
d'algorithme postérieure à la sienne, ce vérificateur refuse de conclure.** Il ne dit ni
« conforme » ni « non conforme » — il dit qu'il est trop ancien et nomme la version qu'il vous
faut.

```ts
import { checkAlgorithmVersion, verifyDraw } from '@drawseal-com/verify';

const verdict = checkAlgorithmVersion(document.algorithmVersion);
if (!verdict.canVerify) {
  // verdict.declared > verdict.supported : mettez le vérificateur à jour.
  // Surtout, ne concluez pas.
  throw new Error(`vérificateur trop ancien : ${verdict.supported} < ${verdict.declared}`);
}

const result = verifyDraw(input);
```

Une version **antérieure** ne pose aucun problème : les règles passées restent rejouables, et un
tirage ancien doit rester vérifiable pour toujours.

## Utilisation

```bash
npm install @drawseal-com/verify   # ou pnpm add / yarn add
```

Ou, si vous préférez lire avant d'exécuter — et c'est le geste qui a du sens ici, un
vérificateur qu'on installe sans le lire demandant la confiance qu'il prétend rendre
inutile :

```bash
git clone https://github.com/drawseal/verify.git
cd verifier && npm install && npm test
```

Les deux publient le même arbre, à la même étiquette, depuis la même pipeline. Le dépôt
git porte les sources et leurs tests ; le paquet npm porte en plus le compilé.

### Vérifier que vous tenez le bon vérificateur

Le risque, sur un outil comme celui-ci, n'est pas qu'il soit absent : c'est qu'un faux
circule — un paquet d'apparence officielle qui répondrait toujours « conforme », ou
toujours l'inverse. Deux adresses, et deux seulement, font foi :

- **npm** : la portée `@drawseal-com` nous appartient, et c'est le seul critère. Tout ce
  qui est publié dessous est de nous ; **tout ce qui ne l'est pas ne l'est pas**, quel que
  soit son nom, sa description ou sa ressemblance avec celui-ci. En particulier, un paquet
  **sans portée** n'est jamais le nôtre — quelle que soit sa proximité typographique.
- **git** : `github.com/drawseal/verify`, et rien d'autre. Le compte `drawseal` porte aussi
  `drawseal/drawseal`, qui est le **témoin** (un fichier par tirage, écrit par la machine) et
  ne contient pas de code.

Un piège nommément : le paquet npm **`drawseal`**, sans portée, existe depuis 2018 et
appartient à un projet sans aucun rapport — une bibliothèque de dessin de sceaux chinois.
C'est d'ailleurs pourquoi notre portée s'écrit `@drawseal-com`, comme le domaine.

Enfin, rien de tout cela ne vous oblige à nous croire sur parole : le compilé publié sur npm
se rejoue depuis les sources. Clonez le dépôt à la même étiquette, lancez `npm run build`,
et comparez.

```ts
import { verifyDraw } from '@drawseal-com/verify';

const result = verifyDraw({
  commitment, // publié AVANT le tirage : empreinte de graine + round drand
  seal, // publié à la clôture des inscriptions : racine de Merkle + round
  beacon, // le beacon drand révélé après
  reveal, // graine, aléa, participants, nombre de gagnants
  claimedWinners, // les gagnants annoncés par la plateforme
});

console.log(result.ok ? 'conforme' : 'ÉCART');
console.table(result);
```

`verifyDraw` ne lève **aucune exception** sur un écart : un écart est un résultat auditable à
afficher, pas une erreur.

Le paquet est isomorphe — il tourne en Node comme dans un navigateur — et n'a que deux
dépendances, toutes deux de Paul Miller : `@noble/hashes` et `@noble/curves`.

## Où trouver le document de vérification

Sur la page publique de chaque tirage, ou directement :

```
https://drawseal.com/api/public/giveaways/<slug>/verification
```

Le tirage est aussi publié hors de notre contrôle, avant sa clôture, chez deux témoins
indépendants : une ancre **OpenTimestamps** dans la chaîne Bitcoin (qui porte l'antériorité) et
un miroir lisible dans le dépôt public [`drawseal/drawseal`](https://github.com/drawseal/drawseal)
(un fichier par tirage, dont l'historique montre chaque version). Confronter le document à ces
deux témoins est le geste qui rend la vérification indépendante de nous.

## Développement

```bash
pnpm install
pnpm test        # suite complète
pnpm build
```

Ce dépôt est **généré depuis le monorepo DrawSeal** à chaque version publiée : c'est ce qui
garantit qu'il ne peut pas diverger du moteur de production. Les correctifs sont donc appliqués
en amont — ouvrez une issue plutôt qu'une pull request, nous la porterons.

## Licence

Apache-2.0 — voir [LICENSE](./LICENSE) et [NOTICE](./NOTICE).

La licence porte sur le code, pas sur la marque : elle n'accorde aucun droit d'usage du nom
« DrawSeal » ni du logo (article 6). Un vérificateur tiers dérivé de ce code est le bienvenu,
sous un autre nom.
