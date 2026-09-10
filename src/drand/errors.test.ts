import { describe, it, expect } from 'vitest';
import { DrandError } from './errors.js';

describe('DrandError', () => {
  it('est une instance de Error et porte le nom du domaine', () => {
    const err = new DrandError('beacon non vérifié');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DrandError);
    expect(err.name).toBe('DrandError');
    expect(err.message).toBe('beacon non vérifié');
  });
});
