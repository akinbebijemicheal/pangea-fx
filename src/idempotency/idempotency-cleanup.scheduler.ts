import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Knex } from 'knex';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { KNEX } from '../database/database.constants.js';

export const IDEMPOTENCY_CLEANUP_JOB = 'idempotency-cleanup';

/**
 * Deletes idempotency keys older than IDEMPOTENCY_KEY_TTL_HOURS, so the table
 * does not grow forever. A key is honoured for at least the TTL; after it is
 * removed, the same key would be treated as a new request (as with Stripe's
 * 24h window). Clients that use a fresh UUID per operation are unaffected.
 */
@Injectable()
export class IdempotencyCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdempotencyCleanupScheduler.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    const cronTime = this.config.get('IDEMPOTENCY_CLEANUP_CRON', { infer: true });
    if (cronTime === 'off') return;
    const job = CronJob.from({
      cronTime,
      timeZone: 'UTC',
      onTick: () => void this.deleteExpired(),
      start: true,
    });
    this.registry.addCronJob(IDEMPOTENCY_CLEANUP_JOB, job);
  }

  /** Returns how many keys were deleted. Never throws: a failed run is retried by the next tick. */
  async deleteExpired(): Promise<number> {
    const ttlHours = this.config.get('IDEMPOTENCY_KEY_TTL_HOURS', { infer: true });
    try {
      const deleted = await this.db('idempotency_keys')
        .where('created_at', '<', this.db.raw(`now() - make_interval(hours => ?)`, [ttlHours]))
        .delete();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} idempotency keys older than ${ttlHours}h`);
      }
      return deleted;
    } catch (err) {
      this.logger.warn(`Idempotency key cleanup failed: ${String(err)}`);
      return 0;
    }
  }
}
