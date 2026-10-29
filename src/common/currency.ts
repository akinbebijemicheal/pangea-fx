/** Supported mock stablecoins. Order here is the order balances are returned in. */
export const CURRENCIES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}
