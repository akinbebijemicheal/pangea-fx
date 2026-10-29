import type { Knex } from 'knex';

/**
 * Idempotency keys now expire (see IdempotencyCleanupScheduler), so a
 * transaction can no longer reference its key by foreign key, and a client may
 * legitimately reuse a key after it expires. The key stays on the transaction
 * for audit and lookup; within the retention window the idempotency_keys
 * primary key is what guarantees a request runs once.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (t) => {
    t.dropForeign('idempotency_key');
    t.dropUnique(['idempotency_key'], 'transactions_idempotency_key_unique');
    t.index(['idempotency_key'], 'transactions_idempotency_key_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (t) => {
    t.dropIndex(['idempotency_key'], 'transactions_idempotency_key_idx');
    t.unique(['idempotency_key'], { indexName: 'transactions_idempotency_key_unique' });
  });
  // NOT VALID: keys already removed by cleanup must not block the rollback.
  await knex.raw(`
    alter table transactions add constraint transactions_idempotency_key_foreign
      foreign key (idempotency_key) references idempotency_keys (key) not valid
  `);
}
