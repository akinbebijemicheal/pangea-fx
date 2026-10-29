import type { Knex } from 'knex';
import * as createWalletsAndBalances from './20261029100000_create_wallets_and_balances.js';
import * as createCurrencies from './20261029110000_create_currencies.js';
import * as createFxRates from './20261029120000_create_fx_rates.js';
import * as addFxRateProvider from './20261029130000_add_fx_rate_provider.js';
import * as createTransactionsAndIdempotencyKeys from './20261029140000_create_transactions_and_idempotency_keys.js';
import * as decoupleTransactionIdempotencyKey from './20261029150000_decouple_transaction_idempotency_key.js';
import * as createWalletTransactionStats from './20261029160000_create_wallet_transaction_stats.js';
import * as tuneWalletTransactionStats from './20261029170000_tune_wallet_transaction_stats.js';

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
  { name: '20261029130000_add_fx_rate_provider', migration: addFxRateProvider },
  {
    name: '20261029140000_create_transactions_and_idempotency_keys',
    migration: createTransactionsAndIdempotencyKeys,
  },
  {
    name: '20261029150000_decouple_transaction_idempotency_key',
    migration: decoupleTransactionIdempotencyKey,
  },
  {
    name: '20261029160000_create_wallet_transaction_stats',
    migration: createWalletTransactionStats,
  },
  {
    name: '20261029170000_tune_wallet_transaction_stats',
    migration: tuneWalletTransactionStats,
  },
];

export const migrationSource: Knex.MigrationSource<NamedMigration> = {
  getMigrations: () => Promise.resolve([...MIGRATIONS]),
  getMigrationName: (m) => m.name,
  getMigration: (m) => Promise.resolve(m.migration),
};
