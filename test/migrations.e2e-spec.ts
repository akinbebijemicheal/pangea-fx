import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { buildKnexConfig } from '../src/database/knex-config.js';
import { MIGRATIONS } from '../src/database/migrations/index.js';
import { findStatsDiscrepancies } from '../src/ledger/reconciliation.js';

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

describe('Migrations: fx_rates provider backfill', () => {
  const getDb = useScratchDatabase();

  it('attributes existing live rows to open.er-api.com and leaves fallback rows empty', async () => {
    const db = getDb();
    await db.migrate.up({ name: '20261029100000_create_wallets_and_balances' });
    await db.migrate.up({ name: '20261029110000_create_currencies' });
    await db.migrate.up({ name: '20261029120000_create_fx_rates' });
    await db('fx_rates').where({ currency: 'USDx' }).update({ source: 'live' });

    await db.migrate.up({ name: '20261029130000_add_fx_rate_provider' });

    const rows = await db('fx_rates').orderBy('currency').select('currency', 'source', 'provider');
    expect(rows.find((r) => r.currency === 'USDx')).toMatchObject({
      source: 'live',
      provider: 'open.er-api.com',
    });
    expect(rows.filter((r) => r.source === 'fallback').every((r) => r.provider === null)).toBe(
      true,
    );
    await expect(
      db('fx_rates').where({ currency: 'cNGN' }).update({ source: 'live' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'fx_rates_live_has_provider' });
  });
});

describe('Migrations: history summary aggregates', () => {
  const getDb = useScratchDatabase();

  async function insertTx(db: Knex, tx: Record<string, unknown>): Promise<void> {
    await db('idempotency_keys').insert({ key: tx.idempotency_key, request_hash: 'x'.repeat(64) });
    await db('transactions').insert(tx);
  }

  it('backfills existing history, then the trigger keeps every new row in step', async () => {
    const db = getDb();
    await db.migrate.up({ name: '20261029100000_create_wallets_and_balances' });
    await db.migrate.up({ name: '20261029110000_create_currencies' });
    await db.migrate.up({ name: '20261029120000_create_fx_rates' });
    await db.migrate.up({ name: '20261029130000_add_fx_rate_provider' });
    await db.migrate.up({ name: '20261029140000_create_transactions_and_idempotency_keys' });
    await db.migrate.up({ name: '20261029150000_decouple_transaction_idempotency_key' });

    const [a] = await db('wallets').insert({ email: 'a@example.com' }).returning('id');
    const [b] = await db('wallets').insert({ email: 'b@example.com' }).returning('id');
    const base = { rate: '1', source_amount: '10', destination_amount: '10' };
    // History written before the stats table exists.
    await insertTx(db, {
      ...base,
      type: 'deposit',
      destination_wallet_id: a.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      idempotency_key: 'k1',
    });
    await insertTx(db, {
      ...base,
      type: 'deposit',
      destination_wallet_id: a.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      idempotency_key: 'k2',
    });
    await insertTx(db, {
      type: 'swap',
      source_wallet_id: a.id,
      destination_wallet_id: a.id,
      source_currency: 'USDx',
      destination_currency: 'EURx',
      source_amount: '5',
      destination_amount: '4',
      rate: '0.8',
      idempotency_key: 'k3',
    });
    await insertTx(db, {
      ...base,
      type: 'transfer',
      source_wallet_id: a.id,
      destination_wallet_id: b.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      idempotency_key: 'k4',
    });

    await db.migrate.up({ name: '20261029160000_create_wallet_transaction_stats' });
    expect(await findStatsDiscrepancies(db)).toEqual([]);
    const aStats = await db('wallet_transaction_stats').where({ wallet_id: a.id });
    expect(aStats.find((r) => r.type === 'deposit')).toMatchObject({
      direction: 'in',
      tx_count: '2',
    });
    expect(aStats.find((r) => r.type === 'swap')).toMatchObject({
      direction: 'self',
      tx_count: '1',
    });

    // New history after the migration goes through the trigger.
    await insertTx(db, {
      ...base,
      type: 'deposit',
      destination_wallet_id: a.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      idempotency_key: 'k5',
    });
    await insertTx(db, {
      ...base,
      type: 'transfer',
      source_wallet_id: b.id,
      destination_wallet_id: a.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      idempotency_key: 'k6',
    });
    expect(await findStatsDiscrepancies(db)).toEqual([]);
    const deposits = await db('wallet_transaction_stats')
      .where({ wallet_id: a.id, type: 'deposit' })
      .first();
    expect(deposits).toMatchObject({ tx_count: '3' });
  });

  it('rolls back cleanly, removing the trigger with the table', async () => {
    const db = getDb();
    await db.migrate.down({ name: '20261029160000_create_wallet_transaction_stats' });
    const [w] = await db('wallets').insert({ email: 'c@example.com' }).returning('id');
    // Inserting a transaction must still work once the trigger is gone.
    await insertTx(db, {
      type: 'deposit',
      destination_wallet_id: w.id,
      source_currency: 'USDx',
      destination_currency: 'USDx',
      source_amount: '1',
      destination_amount: '1',
      rate: '1',
      idempotency_key: 'k7',
    });
    expect(await db.schema.hasTable('wallet_transaction_stats')).toBe(false);
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
