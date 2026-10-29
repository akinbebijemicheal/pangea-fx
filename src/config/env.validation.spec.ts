import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const DATABASE_URL = 'postgres://u:p@localhost:5432/db';

describe('validateEnv', () => {
  it('applies defaults for PORT and NODE_ENV', () => {
    const env = validateEnv({ DATABASE_URL });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validateEnv({ DATABASE_URL, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
