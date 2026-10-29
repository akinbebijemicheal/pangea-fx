import knex from 'knex';
import { buildKnexConfig } from '../database/knex-config.js';
import { findDiscrepancies } from './reconciliation.js';

/**
 * `yarn reconcile`: checks every balance against the transaction log.
 * Exits 0 when the ledger reconciles, 1 (listing each mismatch) when not,
 * so it can gate a deploy or run on a schedule.
 */
async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = knex(buildKnexConfig(url));
  try {
    const discrepancies = await findDiscrepancies(db);
    if (discrepancies.length === 0) {
      console.log('Ledger reconciles: every balance equals the sum of its transactions.');
      return 0;
    }
    console.error(`Ledger does NOT reconcile: ${discrepancies.length} mismatched balance(s).`);
    console.table(discrepancies);
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
