import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../database/transaction-manager.js';
import type { NewTransaction, TransactionRow } from './transaction.types.js';

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
}
