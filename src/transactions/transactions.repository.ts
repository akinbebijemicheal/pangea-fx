import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import type { Currency } from '../common/currency.js';
import { TransactionManager } from '../database/transaction-manager.js';
import type { Cursor } from './cursor.js';
import type { NewTransaction, TransactionRow, TransactionType } from './transaction.types.js';

export interface HistoryQuery {
  walletId: string;
  type?: TransactionType;
  /** Matches either side of the movement. */
  currency?: Currency;
  limit: number;
  after?: Cursor;
}

/** A row plus Postgres's exact text form of created_at, for the next cursor. */
export type HistoryRow = TransactionRow & { created_at_cursor: string };

@Injectable()
export class TransactionsRepository {
  constructor(private readonly tm: TransactionManager) {}

  async insert(tx: NewTransaction): Promise<TransactionRow> {
    const [row] = await this.tm.db<TransactionRow>('transactions').insert(tx).returning('*');
    if (!row) throw new Error('Transaction insert returned no row');
    return row;
  }

  async findById(id: string): Promise<TransactionRow | undefined> {
    return this.tm.db<TransactionRow>('transactions').where({ id }).first();
  }

  /**
   * A wallet's transactions, newest first, keyset-paginated on
   * (created_at, id). Returns up to `limit` rows.
   *
   * Written as a UNION ALL of two index scans (wallet as sender, wallet as
   * receiver) rather than one OR, so each branch walks its own
   * (wallet, created_at desc, id desc) index and stops after `limit` rows.
   * The receiver branch skips rows the wallet also sent (swaps), so each row
   * appears once without UNION's de-duplication sort over every column.
   */
  async findHistory(q: HistoryQuery): Promise<HistoryRow[]> {
    const db = this.tm.db;
    const side = (column: 'source_wallet_id' | 'destination_wallet_id'): Knex.QueryBuilder =>
      db('transactions')
        .select('transactions.*', db.raw('created_at::text as created_at_cursor'))
        .where(column, q.walletId)
        .modify((qb) => {
          if (q.type) qb.where('type', q.type);
          if (q.currency) {
            qb.whereRaw('(source_currency = ? or destination_currency = ?)', [
              q.currency,
              q.currency,
            ]);
          }
          if (q.after) {
            qb.whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [
              q.after.createdAt,
              q.after.id,
            ]);
          }
        })
        .orderBy([
          { column: 'created_at', order: 'desc' },
          { column: 'id', order: 'desc' },
        ])
        .limit(q.limit);

    const sent = side('source_wallet_id');
    const received = side('destination_wallet_id').whereRaw('source_wallet_id is distinct from ?', [
      q.walletId,
    ]);
    const result = await db.raw<{ rows: HistoryRow[] }>(
      'select * from ((?) union all (?)) t order by created_at desc, id desc limit ?',
      [sent, received, q.limit],
    );
    return result.rows;
  }
}
