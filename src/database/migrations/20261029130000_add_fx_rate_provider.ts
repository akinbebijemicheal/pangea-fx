import type { Knex } from 'knex';

/**
 * Records which provider supplied each live quote, so rates can always be
 * attributed even if the configured provider changes. Fallback rows have none.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fx_rates', (t) => {
    t.text('provider');
  });
  // Live rows before this migration could only have come from open.er-api.com.
  await knex('fx_rates').where({ source: 'live' }).update({ provider: 'open.er-api.com' });
  await knex.raw(
    `alter table fx_rates add constraint fx_rates_live_has_provider
       check (source <> 'live' or provider is not null)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fx_rates', (t) => {
    t.dropChecks(['fx_rates_live_has_provider']);
    t.dropColumn('provider');
  });
}
