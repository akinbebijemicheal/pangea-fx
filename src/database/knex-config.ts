import type { Knex } from 'knex';
import { migrationSource } from './migrations/index.js';

/** Single source of Knex config for the app, the migrate CLI and the test setup. */
export function buildKnexConfig(databaseUrl: string): Knex.Config {
  return {
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 10 },
    // Fail fast instead of hanging if the pool is ever exhausted (Knex default: 60s).
    acquireConnectionTimeout: 10_000,
    migrations: { migrationSource, tableName: 'knex_migrations' },
  };
}
