import { describe, expect, it } from 'vitest';
import { CURRENCIES, type Currency } from '../common/currency.js';
import { convert, Money } from '../common/money.js';
import { allPairs, derivePair, type QuoteSet } from './fx-math.js';
import type { UsdQuote } from './fx.types.js';

const T1 = new Date('2026-10-29T10:00:00Z');
const T0 = new Date('2026-10-29T09:00:00Z');

function quotes(overrides: Partial<Record<Currency, Partial<UsdQuote>>> = {}): QuoteSet {
  const perUsd: Record<Currency, string> = {
    cNGN: '1500',
    cGHS: '15',
    cXAF: '600',
    USDx: '1',
    EURx: '0.8',
  };
  return new Map(
    CURRENCIES.map((c) => [
      c,
      {
        currency: c,
        unitsPerUsd: new Money(perUsd[c]),
        source: 'live',
        refreshedAt: T1,
        ...overrides[c],
      },
    ]),
  );
}

describe('derivePair', () => {
  it('divides the target quote by the source quote', () => {
    expect(derivePair(quotes(), 'USDx', 'cNGN').rate.toFixed()).toBe('1500');
    expect(derivePair(quotes(), 'cNGN', 'cGHS').rate.toFixed()).toBe('0.01');
    expect(derivePair(quotes(), 'EURx', 'USDx').rate.toFixed()).toBe('1.25');
  });

  it('rounds non-terminating rates to 15 significant digits', () => {
    expect(derivePair(quotes(), 'cNGN', 'USDx').rate.toFixed()).toBe('0.000666666666666667');
  });

  it('returns exactly 1 for the same currency', () => {
    expect(derivePair(quotes(), 'cGHS', 'cGHS').rate.toFixed()).toBe('1');
  });

  it('reports the weaker source and the older refresh time of the two legs', () => {
    const pair = derivePair(
      quotes({ cNGN: { source: 'cache', refreshedAt: T0 }, EURx: { source: 'fallback' } }),
      'cNGN',
      'EURx',
    );
    expect(pair.source).toBe('fallback');
    expect(pair.refreshedAt).toEqual(T0);
  });

  it('keeps cross rates consistent: no value from a round trip through a third currency', () => {
    const q = quotes({ cXAF: { unitsPerUsd: new Money('564.12302') } });
    const start = new Money('1000');
    for (const a of CURRENCIES) {
      for (const b of CURRENCIES) {
        for (const c of CURRENCIES) {
          const direct = convert(start, derivePair(q, a, c).rate);
          const viaB = convert(convert(start, derivePair(q, a, b).rate), derivePair(q, b, c).rate);
          // Rounding down at each hop means the indirect route can only ever lose value.
          expect(viaB.lte(direct.plus('0.00000001'))).toBe(true);
        }
      }
    }
  });

  it('throws when a quote is missing', () => {
    const q = new Map(quotes());
    q.delete('cXAF');
    expect(() => derivePair(q, 'cXAF', 'USDx')).toThrow(/cXAF/);
  });
});

describe('allPairs', () => {
  it('returns every ordered pair of distinct currencies', () => {
    const pairs = allPairs(quotes());
    expect(pairs).toHaveLength(20);
    expect(new Set(pairs.map((p) => `${p.from}>${p.to}`)).size).toBe(20);
    expect(pairs.some((p) => p.from === p.to)).toBe(false);
  });
});
