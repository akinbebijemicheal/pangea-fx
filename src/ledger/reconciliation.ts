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

export interface StatsDiscrepancy {
  walletId: string;
  direction: string;
  type: string;
  sourceCurrency: string;
  destinationCurrency: string;
  stored: string;
  expected: string;
}

/**
 * Recomputes the wallet_transaction_stats aggregates from the transaction log
 * and returns every row that differs (count or either total). An empty result
 * means history summaries are exact.
 */
export async function findStatsDiscrepancies(
  db: Knex | Knex.Transaction,
  walletIds?: readonly string[],
): Promise<StatsDiscrepancy[]> {
  const scoped = walletIds !== undefined;
  const result = await db.raw<{ rows: StatsDiscrepancy[] }>(
    `
    with legs as (
      select source_wallet_id as wallet_id, 'self' as direction, type, source_currency,
             destination_currency, source_amount, destination_amount
        from transactions where type = 'swap'
      union all
      select source_wallet_id, 'out', type, source_currency, destination_currency,
             source_amount, destination_amount
        from transactions where type = 'transfer'
      union all
      select destination_wallet_id, 'in', type, source_currency, destination_currency,
             source_amount, destination_amount
        from transactions where type in ('deposit', 'transfer')
    ),
    expected as (
      select wallet_id, direction, type, source_currency, destination_currency,
             count(*) as tx_count, sum(source_amount) as source_total,
             sum(destination_amount) as destination_total
        from legs
       group by wallet_id, direction, type, source_currency, destination_currency
    )
    select coalesce(s.wallet_id, e.wallet_id) as "walletId",
           coalesce(s.direction, e.direction) as "direction",
           coalesce(s.type, e.type) as "type",
           coalesce(s.source_currency, e.source_currency) as "sourceCurrency",
           coalesce(s.destination_currency, e.destination_currency) as "destinationCurrency",
           concat_ws(' / ', s.tx_count, s.source_total, s.destination_total) as "stored",
           concat_ws(' / ', e.tx_count, e.source_total, e.destination_total) as "expected"
      from wallet_transaction_stats s
      full outer join expected e using (wallet_id, direction, type, source_currency, destination_currency)
     where (s.tx_count is distinct from e.tx_count
            or s.source_total is distinct from e.source_total
            or s.destination_total is distinct from e.destination_total)
       and (not ?::boolean or coalesce(s.wallet_id, e.wallet_id) = any(?::uuid[]))
     order by 1, 2, 3, 4, 5
    `,
    [scoped, scoped ? [...walletIds] : []],
  );
  return result.rows;
}
