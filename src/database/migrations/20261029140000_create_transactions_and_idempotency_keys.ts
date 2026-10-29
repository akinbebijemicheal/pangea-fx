import type { Knex } from 'knex';

/**
 * transactions: the immutable record of every money movement.
 * idempotency_keys: one row per client Idempotency-Key, written in the same
 * database transaction as the movement it guards.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('idempotency_keys', (t) => {
    t.text('key').primary();
    // sha256 of method, path and canonical body: detects a key reused for a different request.
    t.specificType('request_hash', 'char(64)').notNullable();
    // Null only inside the transaction that claimed the key; set before it commits.
    t.smallint('response_status');
    t.jsonb('response_body');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable();
    // Null for deposits, which come from outside the system.
    t.uuid('source_wallet_id').references('id').inTable('wallets').onDelete('RESTRICT');
    t.uuid('destination_wallet_id')
      .notNullable()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');
    t.text('source_currency').notNullable().references('code').inTable('currencies');
    t.decimal('source_amount', 38, 8).notNullable();
    t.text('destination_currency').notNullable().references('code').inTable('currencies');
    t.decimal('destination_amount', 38, 8).notNullable();
    // 1 unit of source_currency = rate units of destination_currency, as applied.
    t.decimal('rate', 38, 18).notNullable();
    // FX audit trail: where the applied rate came from. Null for deposits.
    t.text('rate_source');
    t.text('rate_provider');
    t.timestamp('rate_refreshed_at', { useTz: true });
    t.text('idempotency_key')
      .notNullable()
      .unique({ indexName: 'transactions_idempotency_key_unique' })
      .references('key')
      .inTable('idempotency_keys');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("type in ('deposit', 'swap', 'transfer')", [], 'transactions_type_valid');
    t.check(
      'source_amount > 0 and destination_amount > 0 and rate > 0',
      [],
      'transactions_amounts_positive',
    );
    t.check(
      "rate_source is null or rate_source in ('live', 'cache', 'fallback')",
      [],
      'transactions_rate_source_valid',
    );
  });

  // Shape rules per type, so no code path can record an impossible movement.
  await knex.raw(`
    alter table transactions add constraint transactions_shape_valid check (
      (type = 'deposit'
        and source_wallet_id is null
        and source_currency = destination_currency
        and source_amount = destination_amount
        and rate = 1)
      or (type = 'swap'
        and source_wallet_id = destination_wallet_id
        and source_currency <> destination_currency)
      or (type = 'transfer'
        and source_wallet_id is not null
        and source_wallet_id <> destination_wallet_id)
    )
  `);

  // History reads: a wallet's transactions newest first, as sender or receiver.
  await knex.raw(
    'create index transactions_source_wallet_created_idx on transactions (source_wallet_id, created_at desc, id desc)',
  );
  await knex.raw(
    'create index transactions_destination_wallet_created_idx on transactions (destination_wallet_id, created_at desc, id desc)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('transactions');
  await knex.schema.dropTable('idempotency_keys');
}
