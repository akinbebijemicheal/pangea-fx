import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Currency } from '../common/currency.js';
import { Money } from '../common/money.js';
import type { CurrenciesService } from '../currencies/currencies.service.js';
import type { FxRatesRepository } from './fx-rates.repository.js';
import { FxService } from './fx.service.js';
import type { FxRateProvider, FxRateRow, ProviderQuotes } from './fx.types.js';

const TTL_MS = 60 * 60_000;
const BACKOFF_MS = 60_000;
const START = new Date('2026-10-29T10:00:00Z').getTime();

const CURRENCY_ROWS: { code: Currency; name: string; fiatCode: string }[] = [
  { code: 'cNGN', name: 'n', fiatCode: 'NGN' },
  { code: 'cGHS', name: 'g', fiatCode: 'GHS' },
  { code: 'cXAF', name: 'x', fiatCode: 'XAF' },
  { code: 'USDx', name: 'u', fiatCode: 'USD' },
  { code: 'EURx', name: 'e', fiatCode: 'EUR' },
];

const SEED: Record<Currency, string> = {
  cNGN: '1550',
  cGHS: '12.5',
  cXAF: '564.12302',
  USDx: '1',
  EURx: '0.86',
};

const LIVE: Record<string, string> = {
  NGN: '1500',
  GHS: '15',
  XAF: '600',
  USD: '1',
  EUR: '0.8',
};

/** In-memory stand-in for the fx_rates table. */
class FakeRatesRepo {
  rows = new Map<Currency, FxRateRow>();

  constructor(at: Date) {
    for (const [currency, units] of Object.entries(SEED) as [Currency, string][]) {
      this.rows.set(currency, {
        currency,
        units_per_usd: units,
        source: 'fallback',
        provider_updated_at: null,
        refreshed_at: at,
      });
    }
  }

  findAll = vi.fn(() => Promise.resolve([...this.rows.values()].map((r) => ({ ...r }))));

  upsertLive = vi.fn(
    (quotes: { currency: Currency; unitsPerUsd: Decimal }[], providerAt: Date, at: Date) => {
      for (const q of quotes) {
        this.rows.set(q.currency, {
          currency: q.currency,
          units_per_usd: q.unitsPerUsd.toFixed(),
          source: 'live',
          provider_updated_at: providerAt,
          refreshed_at: at,
        });
      }
      return Promise.resolve();
    },
  );
}

function providerReturning(rates: Record<string, string> = LIVE): ProviderQuotes {
  return {
    unitsPerUsd: new Map(Object.entries(rates).map(([k, v]) => [k, new Money(v)])),
    providerUpdatedAt: new Date(START - 3_600_000),
  };
}

describe('FxService', () => {
  beforeAll(() => {
    // Failure paths log warnings by design; keep test output readable.
    Logger.overrideLogger(false);
  });

  let now: number;
  let repo: FakeRatesRepo;
  let fetchUsdQuotes: ReturnType<typeof vi.fn<FxRateProvider['fetchUsdQuotes']>>;
  let service: FxService;

  beforeEach(() => {
    now = START;
    repo = new FakeRatesRepo(new Date(START - 86_400_000));
    fetchUsdQuotes = vi.fn<FxRateProvider['fetchUsdQuotes']>();
    const currencies = {
      findAll: () => Promise.resolve(CURRENCY_ROWS),
    } as unknown as CurrenciesService;
    service = new FxService(
      repo as unknown as FxRatesRepository,
      currencies,
      { name: 'fake', fetchUsdQuotes },
      { cacheTtlMs: TTL_MS, retryBackoffMs: BACKOFF_MS },
      () => new Date(now),
    );
  });

  const sources = async () => [...(await service.getQuotes()).values()].map((q) => q.source);

  it('replaces seed rates with live ones on first read', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    const quotes = await service.getQuotes();
    expect(fetchUsdQuotes).toHaveBeenCalledWith(['NGN', 'GHS', 'XAF', 'USD', 'EUR']);
    expect(quotes.get('cNGN')?.unitsPerUsd.toFixed()).toBe('1500');
    expect(quotes.get('cNGN')?.source).toBe('live');
    expect(quotes.get('cNGN')?.refreshedAt).toEqual(new Date(START));
  });

  it('serves fresh live rates without calling the provider again', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    await service.getQuotes();
    now += TTL_MS - 1;
    expect(await sources()).toEqual(Array(5).fill('live'));
    expect(fetchUsdQuotes).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the TTL has passed', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    await service.getQuotes();
    now += TTL_MS;
    fetchUsdQuotes.mockResolvedValue(providerReturning({ ...LIVE, NGN: '1600' }));
    const quotes = await service.getQuotes();
    expect(fetchUsdQuotes).toHaveBeenCalledTimes(2);
    expect(quotes.get('cNGN')?.unitsPerUsd.toFixed()).toBe('1600');
  });

  it('serves seed rates as fallback when the provider has never succeeded', async () => {
    fetchUsdQuotes.mockRejectedValue(new Error('down'));
    const quotes = await service.getQuotes();
    expect(quotes.get('cNGN')?.unitsPerUsd.toFixed()).toBe('1550');
    expect([...quotes.values()].every((q) => q.source === 'fallback')).toBe(true);
    expect(repo.upsertLive).not.toHaveBeenCalled();
  });

  it('serves expired live rates as cache when the provider fails', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    await service.getQuotes();
    now += TTL_MS + 1;
    fetchUsdQuotes.mockRejectedValue(new Error('timeout'));
    const quotes = await service.getQuotes();
    expect(quotes.get('cNGN')?.unitsPerUsd.toFixed()).toBe('1500');
    expect(quotes.get('cNGN')?.source).toBe('cache');
    expect(quotes.get('cNGN')?.refreshedAt).toEqual(new Date(START));
  });

  it('backs off after a failure instead of calling the provider on every request', async () => {
    fetchUsdQuotes.mockRejectedValue(new Error('down'));
    await service.getQuotes();
    now += BACKOFF_MS - 1;
    await service.getQuotes();
    expect(fetchUsdQuotes).toHaveBeenCalledTimes(1);

    now += 1;
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    expect(await sources()).toEqual(Array(5).fill('live'));
    expect(fetchUsdQuotes).toHaveBeenCalledTimes(2);
  });

  it('shares one provider call between concurrent readers', async () => {
    let resolve!: (q: ProviderQuotes) => void;
    fetchUsdQuotes.mockReturnValue(new Promise((r) => (resolve = r)));
    const reads = Array.from({ length: 10 }, () => service.getQuotes());
    resolve(providerReturning());
    const results = await Promise.all(reads);
    expect(fetchUsdQuotes).toHaveBeenCalledTimes(1);
    expect(results.every((q) => q.get('USDx')?.source === 'live')).toBe(true);
  });

  it('treats a response missing one of our currencies as a failure and keeps stored rates', async () => {
    const partial = { ...LIVE };
    delete partial.XAF;
    fetchUsdQuotes.mockResolvedValue(providerReturning(partial));
    const quotes = await service.getQuotes();
    expect(repo.upsertLive).not.toHaveBeenCalled();
    expect(quotes.get('cNGN')?.source).toBe('fallback');
  });

  it('marks only stale rows as cache when rows have mixed ages', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    await service.getQuotes();
    repo.rows.get('cGHS')!.refreshed_at = new Date(START - TTL_MS);
    fetchUsdQuotes.mockRejectedValue(new Error('down'));
    const quotes = await service.getQuotes();
    expect(quotes.get('cGHS')?.source).toBe('cache');
    expect(quotes.get('cNGN')?.source).toBe('live');
  });

  it('getRate derives a pair from the current quotes', async () => {
    fetchUsdQuotes.mockResolvedValue(providerReturning());
    const pair = await service.getRate('USDx', 'cGHS');
    expect(pair.rate.toFixed()).toBe('15');
    expect(pair.source).toBe('live');
  });

  it('fails loudly if a currency has no stored rate at all', async () => {
    fetchUsdQuotes.mockRejectedValue(new Error('down'));
    repo.rows.delete('EURx');
    await expect(service.getQuotes()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
