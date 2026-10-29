import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenErApiProvider, parseOpenErApiResponse } from './open-er-api.provider.js';

const FIATS = ['NGN', 'GHS', 'XAF', 'USD', 'EUR'];

function body(overrides: Record<string, unknown> = {}) {
  return {
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: 1_761_696_000,
    rates: { USD: 1, NGN: 1532.45, GHS: 12.31, XAF: 563.9, EUR: 0.8597, GBP: 0.75 },
    ...overrides,
  };
}

describe('parseOpenErApiResponse', () => {
  it('returns exact decimal quotes for the requested fiat codes only', () => {
    const parsed = parseOpenErApiResponse(body(), FIATS);
    expect([...parsed.unitsPerUsd.keys()]).toEqual(FIATS);
    expect(parsed.unitsPerUsd.get('NGN')?.toString()).toBe('1532.45');
    expect(parsed.unitsPerUsd.get('EUR')?.toString()).toBe('0.8597');
    expect(parsed.providerUpdatedAt.toISOString()).toBe('2025-10-29T00:00:00.000Z');
  });

  it.each([
    ['an error result', { result: 'error' }, /result/],
    ['a non-USD base', { base_code: 'EUR' }, /base/],
    ['a missing update time', { time_last_update_unix: 'yesterday' }, /update time/],
    ['missing rates', { rates: null }, /missing rates/],
    ['a missing currency', { rates: { USD: 1, NGN: 1500, GHS: 12, EUR: 0.9 } }, /XAF/],
    ['a zero rate', { rates: { USD: 1, NGN: 0, GHS: 12, XAF: 560, EUR: 0.9 } }, /NGN/],
    ['a string rate', { rates: { USD: 1, NGN: '1500', GHS: 12, XAF: 560, EUR: 0.9 } }, /NGN/],
  ])('rejects %s', (_label, overrides, error) => {
    expect(() => parseOpenErApiResponse(body(overrides), FIATS)).toThrow(error);
  });
});

describe('OpenErApiProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body()));
    vi.stubGlobal('fetch', fetchMock);
    const quotes = await new OpenErApiProvider('https://fx.test/USD', 1000).fetchUsdQuotes(FIATS);
    expect(quotes.unitsPerUsd.get('GHS')?.toString()).toBe('12.31');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://fx.test/USD',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fails on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(
      new OpenErApiProvider('https://fx.test/USD', 1000).fetchUsdQuotes(FIATS),
    ).rejects.toThrow(/503/);
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      new OpenErApiProvider('https://fx.test/USD', 1000).fetchUsdQuotes(FIATS),
    ).rejects.toThrow(/fetch failed/);
  });
});
