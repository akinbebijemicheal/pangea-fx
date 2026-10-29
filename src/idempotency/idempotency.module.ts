import { Module } from '@nestjs/common';
import { IdempotencyCleanupScheduler } from './idempotency-cleanup.scheduler.js';

@Module({
  providers: [IdempotencyCleanupScheduler],
  exports: [IdempotencyCleanupScheduler],
})
export class IdempotencyModule {}
