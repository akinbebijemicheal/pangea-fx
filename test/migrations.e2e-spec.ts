import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { buildKnexConfig } from '../src/database/knex-config.js';
import { MIGRATIONS } from '../src/database/migrations/index.js';

/**
 * Creates a fresh, dedicated database per suite so rolling back cannot disturb
 * the shared schema other test files use in parallel.
 */
function useScratchDatabase(): () => Knex {
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

  return () => db;
}

describe('Migrations: upgrading a database that already has data', () => {
  const getDb = useScratchDatabase();

  it('keeps existing balances when currencies move into a table', async () => {
    const db = getDb();
    await db.migrate.up(); // only 20261029100000_create_wallets_and_balances
    const [wallet] = await db('wallets').insert({ email: 'old@example.com' }).returning('id');
    await db('balances').insert({ wallet_id: wallet.id, currency: 'cGHS', amount: '12.5' });

    await db.migrate.up({ name: '20261029110000_create_currencies' });

    expect(await db('balances').where({ wallet_id: wallet.id })).toMatchObject([
      { currency: 'cGHS', amount: '12.50000000' },
    ]);
    await expect(
      db('balances').insert({ wallet_id: wallet.id, currency: 'BTC' }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'balances_currency_fk' });
  });

  it('restores the CHECK constraint when the currencies migration is rolled back', async () => {
    const db = getDb();
    await db.migrate.down({ name: '20261029110000_create_currencies' });
    const [wallet] = await db('wallets').insert({ email: 'down@example.com' }).returning('id');
    await expect(
      db('balances').insert({ wallet_id: wallet.id, currency: 'BTC' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'balances_currency_supported' });
  });
});

describe('Migrations (e2e)', () => {
  const getDb = useScratchDatabase();
  let db: Knex;

  beforeAll(() => {
    db = getDb();
  });

  const tables = async () =>
    (
      await db('information_schema.tables')
        .where({ table_schema: 'public' })
        .whereIn('table_name', ['wallets', 'balances', 'currencies'])
        .pluck<string[]>('table_name')
    ).sort();

  it('applies every registered migration on a fresh database', async () => {
    const [, applied] = (await db.migrate.latest()) as [number, string[]];
    expect(applied).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await tables()).toEqual(['balances', 'currencies', 'wallets']);
  });

  it('is a no-op when already up to date', async () => {
    const [, applied] = (await db.migrate.latest()) as [number, string[]];
    expect(applied).toEqual([]);
  });

  it('rolls back cleanly and re-applies', async () => {
    await db.migrate.rollback(undefined, true);
    expect(await tables()).toEqual([]);
    await db.migrate.latest();
    expect(await tables()).toEqual(['balances', 'currencies', 'wallets']);
  });
});
