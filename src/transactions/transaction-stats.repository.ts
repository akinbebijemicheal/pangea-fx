import { Injectable } from '@nestjs/common';
import type { Currency } from '../common/currency.js';
import { TransactionManager } from '../database/transaction-manager.js';
import type { TransactionType } from './transaction.types.js';

export type StatsDirection = 'in' | 'out' | 'self';

export interface StatsRow {
  direction: StatsDirection;
  type: TransactionType;
  source_currency: Currency;
  destination_currency: Currency;
  /** bigint: pg returns it as a string. */
  tx_count: string;
  source_total: string;
  destination_total: string;
}

/**
 * Reads the per-wallet aggregates maintained by the transactions trigger
 * (see the create_wallet_transaction_stats migration). A wallet has at most
 * ~75 rows, so any filtered summary is a primary-key range read of a few rows,
 * independent of how long the wallet's history is.
 */
@Injectable()
export class TransactionStatsRepository {
  constructor(private readonly tm: TransactionManager) {}

  async find(
    walletId: string,
    filter: { type?: TransactionType; currency?: Currency },
  ): Promise<StatsRow[]> {
    return this.tm
      .db<StatsRow>('wallet_transaction_stats')
      .select(
        'direction',
        'type',
        'source_currency',
        'destination_currency',
        'tx_count',
        'source_total',
        'destination_total',
      )
      .where('wallet_id', walletId)
      .modify((qb) => {
        if (filter.type) qb.where('type', filter.type);
        // Same rule as the history list: the currency on either side of the movement.
        if (filter.currency) {
          qb.whereRaw('(source_currency = ? or destination_currency = ?)', [
            filter.currency,
            filter.currency,
          ]);
        }
      });
  }
}
