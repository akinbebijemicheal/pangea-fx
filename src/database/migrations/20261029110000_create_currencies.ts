import type { Knex } from 'knex';

// Frozen snapshot of the supported stablecoins at the time of this migration.
const CURRENCIES = [
  { code: 'cNGN', name: 'Nigerian Naira Coin', fiat_code: 'NGN', sort_order: 1 },
  { code: 'cGHS', name: 'Ghanaian Cedi Coin', fiat_code: 'GHS', sort_order: 2 },
  { code: 'cXAF', name: 'Central African CFA Franc Coin', fiat_code: 'XAF', sort_order: 3 },
  { code: 'USDx', name: 'US Dollar Coin', fiat_code: 'USD', sort_order: 4 },
  { code: 'EURx', name: 'Euro Coin', fiat_code: 'EUR', sort_order: 5 },
];

/**
 * Moves the supported currency list from a CHECK constraint into a reference
 * table, so balances (and later transactions and rates) reference it by FK.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('currencies', (t) => {
    t.text('code').primary();
    t.text('name').notNullable();
    // ISO 4217 code of the fiat currency the stablecoin is pegged to; used for FX lookups.
    t.specificType('fiat_code', 'char(3)').notNullable().unique();
    t.smallint('sort_order').notNullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex('currencies').insert(CURRENCIES);

  await knex.schema.alterTable('balances', (t) => {
    t.dropChecks(['balances_currency_supported']);
    t.foreign('currency', 'balances_currency_fk')
      .references('code')
      .inTable('currencies')
      .onUpdate('RESTRICT')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Inlined literals: Postgres does not accept bind parameters in DDL, and
  // Knex sends check() bindings as $n placeholders inside ALTER TABLE.
  const codes = CURRENCIES.map((c) => `'${c.code}'`).join(', ');
  await knex.schema.alterTable('balances', (t) => {
    t.dropForeign('currency', 'balances_currency_fk');
    t.check(`currency in (${codes})`, [], 'balances_currency_supported');
  });
  await knex.schema.dropTable('currencies');
}
