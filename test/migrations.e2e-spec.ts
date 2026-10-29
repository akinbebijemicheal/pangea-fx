import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { buildKnexConfig } from '../src/database/knex-config.js';
import { MIGRATIONS } from '../src/database/migrations/index.js';

/**
 * Runs against a fresh, dedicated database so rolling back cannot disturb the
 * shared schema other test files use in parallel.
 */
describe('Migrations (e2e)', () => {
  const dbName = `migrations_${randomUUID().replaceAll('-', '')}`;
  let admin: Knex;
  let db: Knex;

  beforeAll(async () => {
    admin = knex({ client: 'pg', connection: inject('databaseUrl') });
    await admin.raw('create database ??', [dbName]);
    const url = new URL(inject('databaseUrl'));
    url.pathname = `/${dbName}`;
    db = knex(buildKnexConfig(url.toString()));
  });

  afterAll(async () => {
    await db.destroy();
    await admin.raw('drop database if exists ?? with (force)', [dbName]);
    await admin.destroy();
  });

  const tables = async () =>
    (
      await db('information_schema.tables')
        .where({ table_schema: 'public' })
        .whereIn('table_name', ['wallets', 'balances'])
        .pluck<string[]>('table_name')
    ).sort();

  it('applies every registered migration on a fresh database', async () => {
    const [, applied] = (await db.migrate.latest()) as [number, string[]];
    expect(applied).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await tables()).toEqual(['balances', 'wallets']);
  });

  it('is a no-op when already up to date', async () => {
    const [, applied] = (await db.migrate.latest()) as [number, string[]];
    expect(applied).toEqual([]);
  });

  it('rolls back cleanly and re-applies', async () => {
    await db.migrate.rollback(undefined, true);
    expect(await tables()).toEqual([]);
    await db.migrate.latest();
    expect(await tables()).toEqual(['balances', 'wallets']);
  });
});
