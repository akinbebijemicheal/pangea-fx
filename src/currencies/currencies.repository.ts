import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../database/transaction-manager.js';
import type { CurrencyRow } from './currency.types.js';

@Injectable()
export class CurrenciesRepository {
  constructor(private readonly tm: TransactionManager) {}

  async findAll(): Promise<CurrencyRow[]> {
    return this.tm.db<CurrencyRow>('currencies').orderBy('sort_order');
  }
}
