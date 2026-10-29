import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../database/transaction-manager.js';
import type { BalanceRow, WalletRow } from './wallet.types.js';

@Injectable()
export class WalletsRepository {
  constructor(private readonly tm: TransactionManager) {}

  /**
   * Inserts the wallet and a zero balance row per supported currency in one
   * transaction. Pre-creating every balance row means later money operations
   * can always lock an existing row with SELECT ... FOR UPDATE instead of
   * racing on upserts.
   */
  async create(contact: { email: string | null; phone: string | null }): Promise<WalletRow> {
    return this.tm.run(async (trx) => {
      const [wallet] = await trx<WalletRow>('wallets').insert(contact).returning('*');
      if (!wallet) throw new Error('Wallet insert returned no row');
      await trx.raw(
        'insert into balances (wallet_id, currency) select ?::uuid, code from currencies',
        [wallet.id],
      );
      return wallet;
    });
  }

  async findById(id: string): Promise<WalletRow | undefined> {
    return this.tm.db<WalletRow>('wallets').where({ id }).first();
  }

  /** Looks up by normalised email or phone; both are unique, so at most one row matches. */
  async findByContact(
    contact: { email: string } | { phone: string },
  ): Promise<WalletRow | undefined> {
    return this.tm.db<WalletRow>('wallets').where(contact).first();
  }

  /** Balances in the currencies table's display order. */
  async findBalances(walletId: string): Promise<BalanceRow[]> {
    return this.tm
      .db<BalanceRow>('balances')
      .join('currencies', 'currencies.code', 'balances.currency')
      .where('balances.wallet_id', walletId)
      .orderBy('currencies.sort_order')
      .select('balances.*');
  }
}
