import type { Knex } from 'knex';
import * as createWalletsAndBalances from './20261029100000_create_wallets_and_balances.js';
import * as createCurrencies from './20261029110000_create_currencies.js';
import * as createFxRates from './20261029120000_create_fx_rates.js';

interface NamedMigration {
  name: string;
  migration: Knex.Migration;
}

/**
 * Migrations are registered statically instead of discovered on disk, so the
 * same list runs under tsc output, Vitest and Docker with no loader config.
 * Append new migrations in order; never edit or reorder applied ones.
 */
export const MIGRATIONS: readonly NamedMigration[] = [
  { name: '20261029100000_create_wallets_and_balances', migration: createWalletsAndBalances },
  { name: '20261029110000_create_currencies', migration: createCurrencies },
  { name: '20261029120000_create_fx_rates', migration: createFxRates },
];

export const migrationSource: Knex.MigrationSource<NamedMigration> = {
  getMigrations: () => Promise.resolve([...MIGRATIONS]),
  getMigrationName: (m) => m.name,
  getMigration: (m) => Promise.resolve(m.migration),
};
