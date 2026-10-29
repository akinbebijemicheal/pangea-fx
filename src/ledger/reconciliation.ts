import type { Knex } from 'knex';
import type { Currency } from '../common/currency.js';

export interface Discrepancy {
  walletId: string;
  currency: Currency;
  /** What the balances table says. */
  balance: string;
  /** Deposits and transfers/swaps in, minus transfers/swaps out, from the transactions table. */
  expected: string;
}

/**
 * Recomputes every balance from the immutable transaction log and returns the
 * (wallet, currency) pairs where the stored balance disagrees. An empty result
 * means no money was created or lost outside a recorded transaction.
 *
 * Pure SQL in NUMERIC, so the comparison is exact. Pass `walletIds` to check
 * a subset (e.g. the wallets one test created); omit it to check everything.
 */
export async function findDiscrepancies(
  db: Knex | Knex.Transaction,
  walletIds?: readonly string[],
): Promise<Discrepancy[]> {
  const scoped = walletIds !== undefined;
  const result = await db.raw<{ rows: Discrepancy[] }>(
    `
    with movements as (
      select destination_wallet_id as wallet_id, destination_currency as currency,
             destination_amount as amount
        from transactions
      union all
      select source_wallet_id, source_currency, -source_amount
        from transactions
       where source_wallet_id is not null
    ),
    expected as (
      select wallet_id, currency, sum(amount) as amount
        from movements
       group by wallet_id, currency
    )
    select coalesce(b.wallet_id, e.wallet_id) as "walletId",
           coalesce(b.currency, e.currency)   as "currency",
           coalesce(b.amount, 0)::text        as "balance",
           coalesce(e.amount, 0)::numeric(38, 8)::text as "expected"
      from balances b
      full outer join expected e
        on e.wallet_id = b.wallet_id and e.currency = b.currency
     where coalesce(b.amount, 0) <> coalesce(e.amount, 0)
       and (not ?::boolean or coalesce(b.wallet_id, e.wallet_id) = any(?::uuid[]))
     order by 1, 2
    `,
    [scoped, scoped ? [...walletIds] : []],
  );
  return result.rows;
}
