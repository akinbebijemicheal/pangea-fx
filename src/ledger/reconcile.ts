import knex from 'knex';
import { buildKnexConfig } from '../database/knex-config.js';
import { findDiscrepancies, findStatsDiscrepancies } from './reconciliation.js';

/**
 * `yarn reconcile`: checks every balance, and the history summary aggregates,
 * against the transaction log.
 * Exits 0 when the ledger reconciles, 1 (listing each mismatch) when not,
 * so it can gate a deploy or run on a schedule.
 */
async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = knex(buildKnexConfig(url));
  try {
    const discrepancies = await findDiscrepancies(db);
    const stats = await findStatsDiscrepancies(db);
    if (discrepancies.length === 0 && stats.length === 0) {
      console.log(
        'Ledger reconciles: every balance and every history summary equals the transaction log.',
      );
      return 0;
    }
    if (discrepancies.length > 0) {
      console.error(`Ledger does NOT reconcile: ${discrepancies.length} mismatched balance(s).`);
      console.table(discrepancies);
    }
    if (stats.length > 0) {
      console.error(`History summaries do NOT reconcile: ${stats.length} mismatched row(s).`);
      console.table(stats);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
