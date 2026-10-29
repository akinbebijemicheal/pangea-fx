import type { Decimal } from 'decimal.js';
import type { Currency } from '../common/currency.js';

/**
 * Where a rate came from, from best to worst:
 * - live: fetched from the provider within the cache TTL
 * - cache: last live rate, older than the TTL because refreshing failed
 * - fallback: fixed seed rate; no live rate has ever been fetched
 */
export type RateSource = 'live' | 'cache' | 'fallback';

export const RATE_SOURCE_RANK: Record<RateSource, number> = { live: 0, cache: 1, fallback: 2 };

/** Worse of two sources: a pair is only as trustworthy as its weaker leg. */
export function worseSource(a: RateSource, b: RateSource): RateSource {
  return RATE_SOURCE_RANK[a] >= RATE_SOURCE_RANK[b] ? a : b;
}

export interface FxRateRow {
  currency: Currency;
  units_per_usd: string;
  source: 'live' | 'fallback';
  provider_updated_at: Date | null;
  refreshed_at: Date;
}

/** One currency's quote against USD, as served. */
export interface UsdQuote {
  currency: Currency;
  unitsPerUsd: Decimal;
  source: RateSource;
  refreshedAt: Date;
}

/** A derived pair rate: 1 unit of `from` buys `rate` units of `to`. */
export interface PairRate {
  from: Currency;
  to: Currency;
  rate: Decimal;
  source: RateSource;
  refreshedAt: Date;
}

/** What a provider returns: units of each ISO fiat code per 1 USD. */
export interface ProviderQuotes {
  unitsPerUsd: Map<string, Decimal>;
  providerUpdatedAt: Date;
}

export interface FxRateProvider {
  readonly name: string;
  fetchUsdQuotes(fiatCodes: readonly string[]): Promise<ProviderQuotes>;
}

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');
export const FX_OPTIONS = Symbol('FX_OPTIONS');
export const CLOCK = Symbol('CLOCK');

export interface FxOptions {
  /** A live rate younger than this is served without refreshing. */
  cacheTtlMs: number;
  /** After a failed refresh, wait this long before trying the provider again. */
  retryBackoffMs: number;
}

export type Clock = () => Date;
