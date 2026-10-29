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

describe('validateEnv DB_MIGRATE_ON_BOOT', () => {
  it('defaults to true', () => {
    expect(validateEnv({ DATABASE_URL }).DB_MIGRATE_ON_BOOT).toBe(true);
  });

  it.each([
    ['false', false],
    ['true', true],
  ])('parses %s', (raw, expected) => {
    expect(validateEnv({ DATABASE_URL, DB_MIGRATE_ON_BOOT: raw }).DB_MIGRATE_ON_BOOT).toBe(
      expected,
    );
  });
});

describe('validateEnv FX refresh settings', () => {
  it('defaults to a daily 00:10 UTC refresh and a refresh at boot', () => {
    const env = validateEnv({ DATABASE_URL });
    expect(env.FX_REFRESH_CRON).toBe('10 0 * * *');
    expect(env.FX_REFRESH_ON_BOOT).toBe(true);
  });

  it.each(['off', '0 */6 * * *', '*/30 * * * * *'])('accepts FX_REFRESH_CRON=%s', (cron) => {
    expect(validateEnv({ DATABASE_URL, FX_REFRESH_CRON: cron }).FX_REFRESH_CRON).toBe(cron);
  });

  it.each(['daily', '61 * * * *', ''])('rejects FX_REFRESH_CRON=%j', (cron) => {
    expect(() => validateEnv({ DATABASE_URL, FX_REFRESH_CRON: cron })).toThrow(/FX_REFRESH_CRON/);
  });

  it('parses FX_REFRESH_ON_BOOT=false', () => {
    expect(validateEnv({ DATABASE_URL, FX_REFRESH_ON_BOOT: 'false' }).FX_REFRESH_ON_BOOT).toBe(
      false,
    );
  });
});

describe('validateEnv idempotency settings', () => {
  it('defaults to a 24h TTL, hourly cleanup and a 5s duplicate wait', () => {
    const env = validateEnv({ DATABASE_URL });
    expect(env.IDEMPOTENCY_KEY_TTL_HOURS).toBe(24);
    expect(env.IDEMPOTENCY_CLEANUP_CRON).toBe('15 * * * *');
    expect(env.IDEMPOTENCY_LOCK_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ['IDEMPOTENCY_KEY_TTL_HOURS', '0'],
    ['IDEMPOTENCY_CLEANUP_CRON', 'hourly'],
    ['IDEMPOTENCY_LOCK_TIMEOUT_MS', '50'],
    ['IDEMPOTENCY_LOCK_TIMEOUT_MS', '60001'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => validateEnv({ DATABASE_URL, [key]: value })).toThrow(new RegExp(key));
  });
});
