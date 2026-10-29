import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Knex } from 'knex';
import type { Currency } from '../common/currency.js';
import { KNEX } from '../database/database.constants.js';
import { TransactionManager } from '../database/transaction-manager.js';
import type { FxRateRow } from './fx.types.js';

@Injectable()
export class FxRatesRepository {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly tm: TransactionManager,
  ) {}

  async findAll(): Promise<FxRateRow[]> {
    // Inside a request transaction this reuses its connection instead of taking
    // a second one from the pool (which can starve the pool under load).
    return this.tm.db<FxRateRow>('fx_rates').select('*');
  }

  /**
   * Replaces every quote with a fresh live set in one statement. Always on the
   * base pool, never the caller's transaction: rates are shared state and must
   * not roll back with whichever request happened to trigger the refresh.
   */
  async upsertLive(
    quotes: { currency: Currency; unitsPerUsd: Decimal }[],
    provider: string,
    providerUpdatedAt: Date,
    refreshedAt: Date,
  ): Promise<void> {
    await this.db('fx_rates')
      .insert(
        quotes.map((q) => ({
          currency: q.currency,
          units_per_usd: q.unitsPerUsd.toFixed(),
          source: 'live',
          provider,
          provider_updated_at: providerUpdatedAt,
          refreshed_at: refreshedAt,
        })),
      )
      .onConflict('currency')
      .merge();
  }
}
