import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CURRENCIES, type Currency } from '../common/currency.js';
import { Money } from '../common/money.js';
import { CurrenciesService } from '../currencies/currencies.service.js';
import { FxRatesRepository } from './fx-rates.repository.js';
import { allPairs, derivePair, type QuoteSet } from './fx-math.js';
import {
  CLOCK,
  type Clock,
  FX_OPTIONS,
  FX_RATE_PROVIDER,
  type FxOptions,
  type FxRateProvider,
  type FxRateRow,
  type PairRate,
  type UsdQuote,
} from './fx.types.js';

/**
 * Serves FX quotes with a live -> cache -> fallback chain:
 *
 * 1. Stored live quotes younger than the TTL are served as `live`.
 * 2. Otherwise the provider is called (one call at a time per process). On
 *    success the stored quotes are replaced and served as `live`.
 * 3. On failure the stored quotes are served as they are: an expired live
 *    quote as `cache`, a seed quote as `fallback`. The provider is not retried
 *    until the backoff passes, so an outage does not add a timeout to every
 *    request.
 *
 * Callers never fail because the provider is down; they see the source.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private inflight: Promise<void> | undefined;
  private nextAttemptAt = 0;

  constructor(
    private readonly rates: FxRatesRepository,
    private readonly currencies: CurrenciesService,
    @Inject(FX_RATE_PROVIDER) private readonly provider: FxRateProvider,
    @Inject(FX_OPTIONS) private readonly options: FxOptions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getQuotes(): Promise<QuoteSet> {
    let rows = await this.rates.findAll();
    if (this.needsRefresh(rows) && this.clock().getTime() >= this.nextAttemptAt) {
      await this.refresh();
      rows = await this.rates.findAll();
    }
    return this.toQuotes(rows);
  }

  async getRate(from: Currency, to: Currency): Promise<PairRate> {
    return derivePair(await this.getQuotes(), from, to);
  }

  async listRates(): Promise<PairRate[]> {
    return allPairs(await this.getQuotes());
  }

  /** Single-flight: concurrent callers share one provider request. */
  refresh(): Promise<void> {
    this.inflight ??= this.fetchAndStore().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchAndStore(): Promise<void> {
    try {
      const currencies = await this.currencies.findAll();
      const fetched = await this.provider.fetchUsdQuotes(currencies.map((c) => c.fiatCode));
      const quotes = currencies.map((c) => {
        const unitsPerUsd = fetched.unitsPerUsd.get(c.fiatCode);
        if (!unitsPerUsd) throw new Error(`provider returned no rate for ${c.fiatCode}`);
        return { currency: c.code, unitsPerUsd };
      });
      await this.rates.upsertLive(quotes, fetched.providerUpdatedAt, this.clock());
      this.nextAttemptAt = 0;
      this.logger.log(`Refreshed FX rates from ${this.provider.name}`);
    } catch (err) {
      this.nextAttemptAt = this.clock().getTime() + this.options.retryBackoffMs;
      this.logger.warn(
        `FX refresh from ${this.provider.name} failed, serving stored rates: ${String(err)}`,
      );
    }
  }

  private isFreshLive(row: FxRateRow): boolean {
    return (
      row.source === 'live' &&
      this.clock().getTime() - row.refreshed_at.getTime() < this.options.cacheTtlMs
    );
  }

  private needsRefresh(rows: FxRateRow[]): boolean {
    return rows.length < CURRENCIES.length || !rows.every((r) => this.isFreshLive(r));
  }

  private toQuotes(rows: FxRateRow[]): QuoteSet {
    const byCurrency = new Map(rows.map((r) => [r.currency, r]));
    const quotes = new Map<Currency, UsdQuote>();
    for (const currency of CURRENCIES) {
      const row = byCurrency.get(currency);
      // Unreachable while the seed rows exist; fail loudly rather than guess a rate.
      if (!row) throw new ServiceUnavailableException(`No FX rate available for ${currency}`);
      quotes.set(currency, {
        currency,
        unitsPerUsd: new Money(row.units_per_usd),
        source: row.source === 'fallback' ? 'fallback' : this.isFreshLive(row) ? 'live' : 'cache',
        refreshedAt: row.refreshed_at,
      });
    }
    return quotes;
  }
}
