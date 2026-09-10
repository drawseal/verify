import { describe, it, expect } from 'vitest';
import { FakeRandomnessSource } from './randomness-source.js';
import { sha256Hex } from './hash.js';

describe('FakeRandomnessSource', () => {
  it('roundAt est déterministe pour une même date', () => {
    const src = new FakeRandomnessSource();
    const d = new Date('2026-07-19T12:00:00.000Z');
    expect(src.roundAt(d)).toBe(src.roundAt(new Date(d.getTime())));
  });

  it('roundAt est monotone croissant dans le temps', () => {
    const src = new FakeRandomnessSource({ periodSeconds: 30 });
    const t0 = new Date('2026-07-19T12:00:00.000Z');
    const later = new Date(t0.getTime() + 60_000); // +2 périodes
    expect(src.roundAt(later)).toBeGreaterThan(src.roundAt(t0));
  });

  it('roundAt regroupe les dates d’une même période sur le même round', () => {
    const src = new FakeRandomnessSource({ periodSeconds: 30 });
    const base = new Date('2026-07-19T12:00:00.000Z');
    const sameWindow = new Date(base.getTime() + 29_000);
    expect(src.roundAt(sameWindow)).toBe(src.roundAt(base));
  });

  it('getRandomness est déterministe et reproductible', async () => {
    const src = new FakeRandomnessSource();
    const a = await src.getRandomness(42);
    const b = await new FakeRandomnessSource().getRandomness(42);
    expect(a).toBe(b);
    expect(a).toBe(sha256Hex('fake-drand|42'));
  });

  it('produit des valeurs distinctes pour des rounds distincts', async () => {
    const src = new FakeRandomnessSource();
    expect(await src.getRandomness(1)).not.toBe(await src.getRandomness(2));
  });
});
