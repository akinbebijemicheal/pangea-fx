/**
 * Supported mock stablecoins. The `currencies` table is the source of truth at
 * runtime; this list exists for compile-time types, request validation and the
 * Swagger enum. CurrenciesService refuses to boot if the two disagree.
 */
export const CURRENCIES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}
