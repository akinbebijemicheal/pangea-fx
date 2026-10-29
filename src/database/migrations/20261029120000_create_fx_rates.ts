import type { Knex } from 'knex';

// Fixed fallback quotes (units of each currency per 1 USD), frozen at the time
// of this migration. Indicative only; they are served when no live rate has
// ever been fetched. XAF is derived from the fixed EUR peg of 655.957 XAF/EUR.
const FALLBACK_UNITS_PER_USD = [
  { currency: 'cNGN', units_per_usd: '1550' },
  { currency: 'cGHS', units_per_usd: '12.5' },
  { currency: 'cXAF', units_per_usd: '564.12302' }, // 0.86 EUR/USD x 655.957 XAF/EUR
  { currency: 'USDx', units_per_usd: '1' },
  { currency: 'EURx', units_per_usd: '0.86' },
];

/**
 * One quote per currency against USD. Pair rates are derived from these at
 * read time, which keeps every cross rate mutually consistent (no triangular
 * arbitrage between independently stored pairs).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('fx_rates', (t) => {
    t.text('currency')
      .primary()
      .references('code')
      .inTable('currencies')
      .onUpdate('RESTRICT')
      .onDelete('RESTRICT');
    t.decimal('units_per_usd', 38, 18).notNullable();
    t.text('source').notNullable();
    // When the provider says it last updated the rate; null for fallback rows.
    t.timestamp('provider_updated_at', { useTz: true });
    // When we last stored this rate.
    t.timestamp('refreshed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check('units_per_usd > 0', [], 'fx_rates_positive');
    t.check("source in ('live', 'fallback')", [], 'fx_rates_source_valid');
  });

  await knex('fx_rates').insert(FALLBACK_UNITS_PER_USD.map((r) => ({ ...r, source: 'fallback' })));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('fx_rates');
}
