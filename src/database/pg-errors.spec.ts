import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './pg-errors.js';

describe('isUniqueViolation', () => {
  const err = { code: '23505', constraint: 'wallets_email_unique' };

  it('matches any unique violation when no constraint is given', () => {
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('matches the named constraint', () => {
    expect(isUniqueViolation(err, 'wallets_email_unique')).toBe(true);
    expect(isUniqueViolation(err, 'wallets_phone_unique')).toBe(false);
  });

  it('ignores other errors', () => {
    expect(isUniqueViolation({ code: '23514' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
