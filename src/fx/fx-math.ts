import { CURRENCIES, type Currency } from '../common/currency.js';
import { Money, roundRate } from '../common/money.js';
import { type PairRate, type UsdQuote, worseSource } from './fx.types.js';

export type QuoteSet = ReadonlyMap<Currency, UsdQuote>;

/**
 * Derives the rate for 1 `from` -> `to` from two USD quotes:
 * (to per USD) / (from per USD). Rounded once, to the precision we apply.
 */
export function derivePair(quotes: QuoteSet, from: Currency, to: Currency): PairRate {
  const a = quotes.get(from);
  const b = quotes.get(to);
  if (!a || !b) throw new Error(`No FX quote for ${a ? to : from}`);
  return {
    from,
    to,
    rate: from === to ? new Money(1) : roundRate(b.unitsPerUsd.div(a.unitsPerUsd)),
    source: worseSource(a.source, b.source),
    provider: a.provider !== null && a.provider === b.provider ? a.provider : null,
    providerUpdatedAt:
      a.providerUpdatedAt && b.providerUpdatedAt
        ? older(a.providerUpdatedAt, b.providerUpdatedAt)
        : null,
    refreshedAt: older(a.refreshedAt, b.refreshedAt),
  };
}

function older(a: Date, b: Date): Date {
  return a < b ? a : b;
}

/** Every ordered pair of distinct supported currencies (20 for 5 currencies). */
export function allPairs(quotes: QuoteSet): PairRate[] {
  return CURRENCIES.flatMap((from) =>
    CURRENCIES.filter((to) => to !== from).map((to) => derivePair(quotes, from, to)),
  );
}
