import type { Knex } from 'knex';

/**
 * Running per-wallet aggregates of the transaction log, so history summaries
 * (counts, debit and credit totals) cost a few rows instead of a scan of the
 * wallet's whole history.
 *
 * One row per (wallet, direction, type, source currency, destination currency):
 * at most 3 x 5 x 5 x 3 rows per wallet. Every history filter (type, and a
 * currency on either side of the movement) maps onto these columns, so any
 * filtered summary is a sum over a handful of rows.
 *
 * Kept up to date by an AFTER INSERT trigger in the same database transaction
 * as the transaction row itself, so it cannot drift from the log whichever code
 * path inserts. Transactions are append-only, so inserts are all it needs.
 *
 * Lock order is fixed (a movement's "out"/"self" row before its "in" row), so
 * concurrent movements cannot deadlock on these rows.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('wallet_transaction_stats', (t) => {
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets').onDelete('RESTRICT');
    t.text('direction').notNullable();
    t.text('type').notNullable();
    t.text('source_currency').notNullable().references('code').inTable('currencies');
    t.text('destination_currency').notNullable().references('code').inTable('currencies');
    t.bigInteger('tx_count').notNullable().defaultTo(0);
    // Unbounded NUMERIC: a sum of many NUMERIC(38,8) amounts can exceed 38 digits.
    t.specificType('source_total', 'numeric').notNullable().defaultTo(0);
    t.specificType('destination_total', 'numeric').notNullable().defaultTo(0);
    t.primary(['wallet_id', 'direction', 'type', 'source_currency', 'destination_currency']);
    t.check("direction in ('in', 'out', 'self')", [], 'wallet_transaction_stats_direction_valid');
  });

  await knex.raw(`
    create function record_wallet_transaction_stats() returns trigger
    language plpgsql as $$
    begin
      insert into wallet_transaction_stats as s
        (wallet_id, direction, type, source_currency, destination_currency,
         tx_count, source_total, destination_total)
      select w.wallet_id, w.direction, new.type, new.source_currency, new.destination_currency,
             1, new.source_amount, new.destination_amount
        from (values
          (1, case when new.type = 'swap' then new.source_wallet_id end, 'self'),
          (2, case when new.type = 'transfer' then new.source_wallet_id end, 'out'),
          (3, case when new.type in ('deposit', 'transfer') then new.destination_wallet_id end, 'in')
        ) as w(ord, wallet_id, direction)
       where w.wallet_id is not null
       order by w.ord
      on conflict (wallet_id, direction, type, source_currency, destination_currency)
      do update set tx_count = s.tx_count + 1,
                    source_total = s.source_total + excluded.source_total,
                    destination_total = s.destination_total + excluded.destination_total;
      return null;
    end
    $$
  `);
  await knex.raw(`
    create trigger transactions_wallet_stats
      after insert on transactions
      for each row execute function record_wallet_transaction_stats()
  `);

  // Backfill from history already in the log.
  await knex.raw(`
    insert into wallet_transaction_stats
      (wallet_id, direction, type, source_currency, destination_currency,
       tx_count, source_total, destination_total)
    select wallet_id, direction, type, source_currency, destination_currency,
           count(*), sum(source_amount), sum(destination_amount)
      from (
        select source_wallet_id as wallet_id, 'self' as direction, t.* from transactions t
         where type = 'swap'
        union all
        select source_wallet_id, 'out', t.* from transactions t where type = 'transfer'
        union all
        select destination_wallet_id, 'in', t.* from transactions t
         where type in ('deposit', 'transfer')
      ) legs
     group by wallet_id, direction, type, source_currency, destination_currency
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop trigger transactions_wallet_stats on transactions');
  await knex.raw('drop function record_wallet_transaction_stats()');
  await knex.schema.dropTable('wallet_transaction_stats');
}
