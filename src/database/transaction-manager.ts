import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX } from './database.constants.js';

/**
 * Carries the current database transaction through async calls, so the
 * idempotency interceptor, services and repositories all write in the same
 * transaction without passing `trx` through every signature.
 */
@Injectable()
export class TransactionManager {
  private readonly storage = new AsyncLocalStorage<Knex.Transaction>();

  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  /** The active transaction, or the pool when none is active. Repositories query through this. */
  get db(): Knex | Knex.Transaction {
    return this.storage.getStore() ?? this.knex;
  }

  get inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** Runs `fn` in the active transaction, or in a new one if there is none. */
  run<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    const current = this.storage.getStore();
    if (current) return fn(current);
    return this.knex.transaction((trx) => this.storage.run(trx, () => fn(trx)));
  }

  /**
   * Runs `fn` in a savepoint of the active transaction: if `fn` throws, only
   * its own writes roll back and the outer transaction can still commit.
   */
  savepoint<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    const current = this.storage.getStore();
    if (!current) throw new Error('savepoint() requires an active transaction');
    return current.transaction((sp) => this.storage.run(sp, () => fn(sp)));
  }
}
