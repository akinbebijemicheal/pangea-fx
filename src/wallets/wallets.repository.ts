import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { CURRENCIES } from '../common/currency.js';
import { KNEX } from '../database/database.constants.js';
import type { BalanceRow, WalletRow } from './wallet.types.js';

@Injectable()
export class WalletsRepository {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  /**
   * Inserts the wallet and a zero balance row per currency in one transaction.
   * Pre-creating every balance row means later money operations can always
   * lock an existing row with SELECT ... FOR UPDATE instead of racing on upserts.
   */
  async create(contact: { email: string | null; phone: string | null }): Promise<WalletRow> {
    return this.db.transaction(async (trx) => {
      const [wallet] = await trx<WalletRow>('wallets').insert(contact).returning('*');
      if (!wallet) throw new Error('Wallet insert returned no row');
      await trx('balances').insert(
        CURRENCIES.map((currency) => ({ wallet_id: wallet.id, currency, amount: 0 })),
      );
      return wallet;
    });
  }

  async findById(id: string): Promise<WalletRow | undefined> {
    return this.db<WalletRow>('wallets').where({ id }).first();
  }

  async findBalances(walletId: string): Promise<BalanceRow[]> {
    return this.db<BalanceRow>('balances').where({ wallet_id: walletId });
  }
}
