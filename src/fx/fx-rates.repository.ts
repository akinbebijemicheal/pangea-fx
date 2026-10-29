import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Knex } from 'knex';
import type { Currency } from '../common/currency.js';
import { KNEX } from '../database/database.constants.js';
import type { FxRateRow } from './fx.types.js';

@Injectable()
export class FxRatesRepository {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async findAll(): Promise<FxRateRow[]> {
    return this.db<FxRateRow>('fx_rates').select('*');
  }

  /** Replaces every quote with a fresh live set in one statement. */
  async upsertLive(
    quotes: { currency: Currency; unitsPerUsd: Decimal }[],
    providerUpdatedAt: Date,
    refreshedAt: Date,
  ): Promise<void> {
    await this.db('fx_rates')
      .insert(
        quotes.map((q) => ({
          currency: q.currency,
          units_per_usd: q.unitsPerUsd.toFixed(),
          source: 'live',
          provider_updated_at: providerUpdatedAt,
          refreshed_at: refreshedAt,
        })),
      )
      .onConflict('currency')
      .merge();
  }
}
