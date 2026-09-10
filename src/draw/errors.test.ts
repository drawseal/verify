import { describe, it, expect } from 'vitest';
import { DrawEngineError } from './errors.js';

describe('DrawEngineError', () => {
  it('est une instance de Error', () => {
    const err = new DrawEngineError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DrawEngineError);
  });

  it('porte le nom du domaine et conserve le message', () => {
    const err = new DrawEngineError('pool vide');
    expect(err.name).toBe('DrawEngineError');
    expect(err.message).toBe('pool vide');
  });
});
