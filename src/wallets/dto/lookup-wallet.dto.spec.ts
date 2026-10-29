import { describe, expect, it } from 'vitest';
import { normalizeQueryPhone } from './lookup-wallet.dto.js';

describe('normalizeQueryPhone', () => {
  it("restores a '+' that the query string decoded as a space", () => {
    expect(normalizeQueryPhone(' 233201234567')).toBe('+233201234567');
  });

  it('keeps an encoded or already-correct + as is', () => {
    expect(normalizeQueryPhone('+233201234567')).toBe('+233201234567');
  });

  it('still strips separators', () => {
    expect(normalizeQueryPhone(' 233 20-123-4567')).toBe('+233201234567');
  });

  it('does not invent a + for other leading spaces', () => {
    expect(normalizeQueryPhone('  233201234567')).toBe('233201234567');
    expect(normalizeQueryPhone(' abc')).toBe('abc');
  });

  it('passes non-strings through for validation to reject', () => {
    expect(normalizeQueryPhone(42)).toBe(42);
  });
});
