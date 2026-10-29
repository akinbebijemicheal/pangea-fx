import { Money } from '../../src/common/money.js';
import type { FxRateProvider, ProviderQuotes } from '../../src/fx/fx.types.js';

/**
 * Deterministic provider for e2e tests: no network, round numbers so expected
 * conversions can be written by hand. Every test app uses the same values, so
 * parallel test files sharing the fx_rates table always agree.
 */
export const FAKE_UNITS_PER_USD: Record<string, string> = {
  NGN: '1500',
  GHS: '15',
  XAF: '600',
  USD: '1',
  EUR: '0.8',
};

export class FakeFxProvider implements FxRateProvider {
  readonly name = 'fake';
  calls = 0;

  fetchUsdQuotes(fiatCodes: readonly string[]): Promise<ProviderQuotes> {
    this.calls++;
    return Promise.resolve({
      unitsPerUsd: new Map(fiatCodes.map((c) => [c, new Money(FAKE_UNITS_PER_USD[c]!)])),
      providerUpdatedAt: new Date('2026-10-29T00:00:00Z'),
    });
  }
}
