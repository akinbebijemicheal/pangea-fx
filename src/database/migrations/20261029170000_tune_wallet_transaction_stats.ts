import type { Knex } from 'knex';

/**
 * wallet_transaction_stats is tiny but updated on every money movement, and
 * each Postgres UPDATE leaves a dead row version until vacuum removes it.
 *
 * - fillfactor 50 keeps free space on each page so updates can be HOT
 *   (rewritten in place with no new index entries). The updated columns
 *   (tx_count and the totals) are not indexed, so they qualify.
 * - Vacuum after a fixed number of dead rows instead of a fraction of a table
 *   that is always small, so dead versions never pile up behind a hot wallet.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    alter table wallet_transaction_stats set (
      fillfactor = 50,
      autovacuum_vacuum_scale_factor = 0,
      autovacuum_vacuum_threshold = 1000,
      autovacuum_analyze_scale_factor = 0,
      autovacuum_analyze_threshold = 1000
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    alter table wallet_transaction_stats reset (
      fillfactor,
      autovacuum_vacuum_scale_factor,
      autovacuum_vacuum_threshold,
      autovacuum_analyze_scale_factor,
      autovacuum_analyze_threshold
    )
  `);
}
