import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../common/currency.js';
import type { CurrenciesRepository } from './currencies.repository.js';
import { CurrenciesService } from './currencies.service.js';
import type { CurrencyRow } from './currency.types.js';

function serviceWith(codes: string[]): CurrenciesService {
  const rows = codes.map(
    (code, i) =>
      ({
        code,
        name: code,
        fiat_code: 'XXX',
        sort_order: i + 1,
        created_at: new Date(),
      }) as CurrencyRow,
  );
  const repo = { findAll: () => Promise.resolve(rows) } as unknown as CurrenciesRepository;
  return new CurrenciesService(repo);
}

describe('CurrenciesService boot check', () => {
  it('passes when the table matches CURRENCIES', async () => {
    await expect(serviceWith([...CURRENCIES]).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails when the table is missing a currency', async () => {
    await expect(serviceWith(CURRENCIES.slice(1)).onApplicationBootstrap()).rejects.toThrow(
      /does not match/,
    );
  });

  it('fails when the table has an extra currency', async () => {
    await expect(serviceWith([...CURRENCIES, 'cKES']).onApplicationBootstrap()).rejects.toThrow(
      /cKES/,
    );
  });

  it('fails when the order differs', async () => {
    await expect(serviceWith([...CURRENCIES].reverse()).onApplicationBootstrap()).rejects.toThrow(
      /does not match/,
    );
  });
});
