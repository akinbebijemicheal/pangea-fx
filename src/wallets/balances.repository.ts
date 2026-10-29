import { Injectable } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Currency } from '../common/currency.js';
import { TransactionManager } from '../database/transaction-manager.js';

/** Balance writes. Runs in the caller's transaction via TransactionManager. */
@Injectable()
export class BalancesRepository {
  constructor(private readonly tm: TransactionManager) {}

  /**
   * Adds `amount` in a single atomic UPDATE, so concurrent credits cannot lose
   * updates and no explicit lock is needed. Returns the new balance, or
   * undefined if the wallet does not exist.
   */
  async credit(walletId: string, currency: Currency, amount: Decimal): Promise<string | undefined> {
    const db = this.tm.db;
    const [row] = await db('balances')
      .where({ wallet_id: walletId, currency })
      .update({
        amount: db.raw('amount + ?::numeric', [amount.toFixed()]),
        updated_at: db.fn.now(),
      })
      .returning<{ amount: string }[]>('amount');
    return row?.amount;
  }
}
