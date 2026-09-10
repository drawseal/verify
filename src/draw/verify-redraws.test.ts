import { describe, expect, it } from 'vitest';
import { computeWeights } from './compute-weights.js';
import { computeWinners } from './compute-winners.js';
import { verifyRedraws, type Designation } from './verify-redraws.js';

const SEED = 'seed-revele-apres-le-tirage';
const DRAND = 'f'.repeat(64);

/** Quatre participants sans parrainage : les poids valent 1 et ne bougent pas. */
const FLAT_IDS = ['p1', 'p2', 'p3', 'p4'];
const flatParticipants = FLAT_IDS.map((id) => ({ id, referredByParticipantId: null }));

function flatInput(over: Partial<Parameters<typeof verifyRedraws>[0]> = {}) {
  return {
    serverSeed: SEED,
    drandValue: DRAND,
    winnersCount: 1,
    weightingMode: 'equal' as const,
    sealedValidIds: FLAT_IDS,
    referrals: flatParticipants,
    referralBonusEntries: 0,
    designations: [] as Designation[],
    ...over,
  };
}

/** Rejoue la cascade initiale pour connaître le gagnant honnête d'un rang. */
function honestInitial(winnersCount: number): string[] {
  return computeWinners({
    serverSeed: SEED,
    drandValue: DRAND,
    winnersCount,
    participants: computeWeights({
      weightingMode: 'equal',
      validIds: FLAT_IDS,
      participants: flatParticipants,
      referralBonusEntries: 0,
    }),
  }).winners.map((w) => w.participantId);
}

/** Rejoue le remplaçant honnête d'un rang, sur le pool privé des `excluded`. */
function honestReplacement(excluded: string[]): string {
  const remaining = FLAT_IDS.filter((id) => !excluded.includes(id));
  return computeWinners({
    serverSeed: SEED,
    drandValue: DRAND,
    winnersCount: 1,
    participants: computeWeights({
      weightingMode: 'equal',
      validIds: remaining,
      participants: flatParticipants,
      referralBonusEntries: 0,
    }),
  }).winners[0].participantId;
}

describe('verifyRedraws', () => {
  // Sans forfait, il n'y a rien à rejouer — et surtout, ce cas ne doit pas produire d'écart.
  it('un tirage sans re-tirage est conforme', () => {
    const [initial] = honestInitial(1);
    const result = verifyRedraws(
      flatInput({
        designations: [{ order: 0, rank: 1, participantId: initial, status: 'pending' }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(0);
  });

  // Le cœur du correctif : un forfait suivi d'un re-tirage honnête doit se **rejouer**, donc
  // sortir conforme. C'est le cas qui, avant, affichait un verdict rouge sur un tirage honnête.
  it('BLOQUANT : un re-tirage honnête se rejoue et sort conforme', () => {
    const [initial] = honestInitial(1);
    const replacement = honestReplacement([initial]);
    const result = verifyRedraws(
      flatInput({
        designations: [
          { order: 0, rank: 1, participantId: initial, status: 'forfeited' },
          { order: 1, rank: 1, participantId: replacement, status: 'pending' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(1);
  });

  // La raison d'être du contrôle : un remplaçant choisi à la main, et non dérivé, doit être
  // démasqué. Sans cela, un exploitant force un forfait puis désigne qui il veut.
  it('BLOQUANT : un remplaçant qui ne dérive pas du calcul est refusé', () => {
    const [initial] = honestInitial(1);
    const replacement = honestReplacement([initial]);
    const impostor = FLAT_IDS.find((id) => id !== initial && id !== replacement) as string;
    const result = verifyRedraws(
      flatInput({
        designations: [
          { order: 0, rank: 1, participantId: initial, status: 'forfeited' },
          { order: 1, rank: 1, participantId: impostor, status: 'pending' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toMatchObject({ order: 1, rank: 1, claimed: impostor });
  });

  // Un forfaité n'est jamais repêché (`designatedWinnerIds` ne filtre pas sur le statut). Si le
  // rejeu ne reproduisait pas cette exclusion, un second forfait sur le même rang divergerait.
  it('BLOQUANT : un participant déjà désigné est exclu des re-tirages suivants', () => {
    const [initial] = honestInitial(1);
    const second = honestReplacement([initial]);
    const third = honestReplacement([initial, second]);
    const result = verifyRedraws(
      flatInput({
        designations: [
          { order: 0, rank: 1, participantId: initial, status: 'forfeited' },
          { order: 1, rank: 1, participantId: second, status: 'forfeited' },
          { order: 2, rank: 1, participantId: third, status: 'pending' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(2);
  });

  // L'exclusion porte sur **tous les rangs**, pas seulement le rang re-tiré : personne ne gagne
  // deux lots. Un rejeu qui n'exclurait que le rang courant désignerait le gagnant d'un autre rang.
  it('BLOQUANT : exclut les gagnants des autres rangs', () => {
    const initial = honestInitial(2);
    const replacement = honestReplacement(initial);
    const result = verifyRedraws(
      flatInput({
        winnersCount: 2,
        designations: [
          { order: 0, rank: 1, participantId: initial[0], status: 'pending' },
          { order: 1, rank: 2, participantId: initial[1], status: 'forfeited' },
          { order: 2, rank: 2, participantId: replacement, status: 'pending' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  // La cascade initiale doit rester celle que `computeWinners` impose : c'est elle que le sceau
  // et l'engagement couvrent. Une première désignation falsifiée doit être vue ici.
  it('BLOQUANT : une cascade initiale falsifiée est refusée', () => {
    const [initial] = honestInitial(1);
    const impostor = FLAT_IDS.find((id) => id !== initial) as string;
    const result = verifyRedraws(
      flatInput({
        designations: [{ order: 0, rank: 1, participantId: impostor, status: 'pending' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toMatchObject({ order: 0, rank: 1 });
  });

  // En mode pondéré, retirer un gagnant retire un filleul valide à son parrain, dont le poids
  // baisse. Une soustraction naïve du pool scellé donnerait un autre remplaçant — et ferait
  // échouer la vérification d'un re-tirage parfaitement honnête. C'est la raison pour laquelle le
  // graphe de parrainage est publié.
  it('BLOQUANT : en mode pondéré, les poids sont recalculés sur le pool réduit', () => {
    const ids = ['sponsor', 'filleul1', 'filleul2', 'autre'];
    const referrals = [
      { id: 'sponsor', referredByParticipantId: null },
      { id: 'filleul1', referredByParticipantId: 'sponsor' },
      { id: 'filleul2', referredByParticipantId: 'sponsor' },
      { id: 'autre', referredByParticipantId: null },
    ];
    const weighted = (validIds: string[]) =>
      computeWeights({
        weightingMode: 'weighted',
        validIds,
        participants: referrals,
        referralBonusEntries: 5,
      });

    // Le poids du parrain doit réellement changer entre les deux pools, sinon le test ne prouve rien.
    const before = weighted(ids).find((p) => p.id === 'sponsor')?.weight;
    const after = weighted(ids.filter((id) => id !== 'filleul1')).find(
      (p) => p.id === 'sponsor',
    )?.weight;
    expect(before).not.toBe(after);

    const initial = computeWinners({
      serverSeed: SEED,
      drandValue: DRAND,
      winnersCount: 1,
      participants: weighted(ids),
    }).winners[0].participantId;
    const replacement = computeWinners({
      serverSeed: SEED,
      drandValue: DRAND,
      winnersCount: 1,
      participants: weighted(ids.filter((id) => id !== initial)),
    }).winners[0].participantId;

    const result = verifyRedraws({
      serverSeed: SEED,
      drandValue: DRAND,
      winnersCount: 1,
      weightingMode: 'weighted',
      sealedValidIds: ids,
      referrals,
      referralBonusEntries: 5,
      designations: [
        { order: 0, rank: 1, participantId: initial, status: 'forfeited' },
        { order: 1, rank: 1, participantId: replacement, status: 'pending' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  // L'ordre chronologique est ce qui rend le rejeu reproductible : le désordonner change
  // l'ensemble exclu à chaque étape. La fonction doit trier elle-même plutôt que faire confiance.
  it('trie les désignations par ordre global avant de rejouer', () => {
    const [initial] = honestInitial(1);
    const replacement = honestReplacement([initial]);
    const result = verifyRedraws(
      flatInput({
        designations: [
          { order: 1, rank: 1, participantId: replacement, status: 'pending' },
          { order: 0, rank: 1, participantId: initial, status: 'forfeited' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  // Un pool épuisé n'est pas une falsification : c'est un fait, à distinguer d'un écart de calcul
  // pour que la page publique n'accuse pas un organisateur honnête.
  it('distingue un pool épuisé d’un écart de calcul', () => {
    const designations: Designation[] = [];
    let excluded: string[] = [];
    for (let i = 0; i < FLAT_IDS.length; i += 1) {
      const winner = i === 0 ? honestInitial(1)[0] : honestReplacement(excluded);
      designations.push({ order: i, rank: 1, participantId: winner, status: 'forfeited' });
      excluded = [...excluded, winner];
    }
    const result = verifyRedraws(flatInput({ designations }));
    expect(result.ok).toBe(true);
    expect(result.poolExhausted).toBe(true);
  });
});
