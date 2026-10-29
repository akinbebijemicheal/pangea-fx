import { Money } from '../common/money.js';
import type { FxRateProvider, ProviderInfo, ProviderQuotes } from './fx.types.js';

interface OpenErApiResponse {
  result?: unknown;
  time_last_update_unix?: unknown;
  base_code?: unknown;
  rates?: unknown;
}

/**
 * open.er-api.com: free, keyless, USD-based daily rates that include NGN, GHS
 * and XAF. Any malformed or partial response is treated as a failure, so the
 * caller falls back instead of storing a bad rate.
 */
export class OpenErApiProvider implements FxRateProvider {
  readonly name = 'open.er-api.com';
  readonly info: ProviderInfo = {
    name: this.name,
    url: 'https://www.exchangerate-api.com',
    // Free tier publishes once a day, shortly after 00:00 UTC.
    updateFrequency: 'daily',
    // Required by the free tier's terms of use.
    attribution: 'Rates By Exchange Rate API',
  };

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async fetchUsdQuotes(fiatCodes: readonly string[]): Promise<ProviderQuotes> {
    const res = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`${this.name} responded ${res.status}`);
    return parseOpenErApiResponse((await res.json()) as OpenErApiResponse, fiatCodes);
  }
}

export function parseOpenErApiResponse(
  body: OpenErApiResponse,
  fiatCodes: readonly string[],
): ProviderQuotes {
  if (body.result !== 'success') throw new Error(`provider result: ${String(body.result)}`);
  if (body.base_code !== 'USD') throw new Error(`unexpected base: ${String(body.base_code)}`);
  if (typeof body.time_last_update_unix !== 'number') throw new Error('missing update time');
  if (typeof body.rates !== 'object' || body.rates === null) throw new Error('missing rates');

  const rates = body.rates as Record<string, unknown>;
  const unitsPerUsd = new Map<string, Money>();
  for (const code of fiatCodes) {
    const raw = rates[code];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(`missing or invalid rate for ${code}`);
    }
    // The provider sends JSON numbers; String() gives the shortest exact
    // representation of that double, which is what the provider meant.
    unitsPerUsd.set(code, new Money(String(raw)));
  }
  return { unitsPerUsd, providerUpdatedAt: new Date(body.time_last_update_unix * 1000) };
}
