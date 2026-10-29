import { describe, expect, it } from 'vitest';
import { CURRENCIES, isCurrency } from './currency.js';

describe('isCurrency', () => {
  it.each(CURRENCIES)('accepts %s', (c) => {
    expect(isCurrency(c)).toBe(true);
  });

  it.each(['cngn', 'USD', 'BTC', '', 1, null])('rejects %j', (c) => {
    expect(isCurrency(c)).toBe(false);
  });
});
