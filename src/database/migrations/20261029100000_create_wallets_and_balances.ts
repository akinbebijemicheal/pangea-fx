import type { Knex } from 'knex';

// Migrations are frozen snapshots: the currency list is inlined, not imported,
// so later changes to CURRENCIES need their own migration.
const CURRENCIES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('wallets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('email').unique({ indexName: 'wallets_email_unique' });
    t.text('phone').unique({ indexName: 'wallets_phone_unique' });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check('email is not null or phone is not null', [], 'wallets_contact_present');
  });

  await knex.schema.createTable('balances', (t) => {
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets').onDelete('RESTRICT');
    t.text('currency').notNullable();
    t.decimal('amount', 38, 8).notNullable().defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['wallet_id', 'currency']);
    t.check(
      `currency in (${CURRENCIES.map(() => '?').join(', ')})`,
      CURRENCIES,
      'balances_currency_supported',
    );
    // Last line of defence: no code path may ever leave a balance negative.
    t.check('amount >= 0', [], 'balances_amount_non_negative');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('balances');
  await knex.schema.dropTable('wallets');
}
