import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX } from '../database/database.constants.js';
import type { CurrencyRow } from './currency.types.js';

@Injectable()
export class CurrenciesRepository {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async findAll(): Promise<CurrencyRow[]> {
    return this.db<CurrencyRow>('currencies').orderBy('sort_order');
  }
}
