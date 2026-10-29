import { Injectable } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Currency } from '../common/currency.js';
import { TransactionManager } from '../database/transaction-manager.js';

export interface BalanceRef {
  walletId: string;
  currency: Currency;
}

export function balanceKey(ref: BalanceRef): string {
  return `${ref.walletId}:${ref.currency}`;
}

/** Balance reads and writes. Runs in the caller's transaction via TransactionManager. */
@Injectable()
export class BalancesRepository {
  constructor(private readonly tm: TransactionManager) {}

  /**
   * Locks the given balance rows with SELECT ... FOR UPDATE, always in
   * (wallet_id, currency) order. Every caller locking in the same order is
   * what makes concurrent movements in opposite directions unable to
   * deadlock. Returns current amounts keyed by balanceKey(); a missing key
   * means that wallet does not exist.
   */
  async lock(refs: BalanceRef[]): Promise<Map<string, string>> {
    const rows = await this.tm
      .db('balances')
      .select<{ wallet_id: string; currency: Currency; amount: string }[]>(
        'wallet_id',
        'currency',
        'amount',
      )
      .whereIn(
        ['wallet_id', 'currency'],
        refs.map((r) => [r.walletId, r.currency]),
      )
      .orderBy([
        { column: 'wallet_id', order: 'asc' },
        { column: 'currency', order: 'asc' },
      ])
      .forUpdate();
    return new Map(
      rows.map((r) => [balanceKey({ walletId: r.wallet_id, currency: r.currency }), r.amount]),
    );
  }

  /**
   * Adds `amount` in a single atomic UPDATE, so concurrent credits cannot lose
   * updates and no explicit lock is needed. Returns the new balance, or
   * undefined if the wallet does not exist.
   */
  async credit(walletId: string, currency: Currency, amount: Decimal): Promise<string | undefined> {
    return this.adjust(walletId, currency, 'amount + ?::numeric', amount);
  }

  /**
   * Subtracts `amount`. Callers lock and check funds first; the balances
   * CHECK (amount >= 0) still rejects an overdraft if a caller ever does not.
   */
  async debit(walletId: string, currency: Currency, amount: Decimal): Promise<string | undefined> {
    return this.adjust(walletId, currency, 'amount - ?::numeric', amount);
  }

  private async adjust(
    walletId: string,
    currency: Currency,
    expression: string,
    amount: Decimal,
  ): Promise<string | undefined> {
    const db = this.tm.db;
    const [row] = await db('balances')
      .where({ wallet_id: walletId, currency })
      .update({ amount: db.raw(expression, [amount.toFixed()]), updated_at: db.fn.now() })
      .returning<{ amount: string }[]>('amount');
    return row?.amount;
  }
}
