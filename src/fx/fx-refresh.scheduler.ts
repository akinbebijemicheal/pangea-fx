import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { FxService } from './fx.service.js';

export const FX_REFRESH_JOB = 'fx-refresh';

/**
 * Keeps stored rates current without waiting for traffic: a daily cron (UTC)
 * timed after the provider publishes, plus one background refresh at boot.
 * Requests still refresh lazily when rates outlive the TTL, so a missed cron
 * run only means the next reader triggers the refresh instead.
 */
@Injectable()
export class FxRefreshScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FxRefreshScheduler.name);

  constructor(
    private readonly fx: FxService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    const cronTime = this.config.get('FX_REFRESH_CRON', { infer: true });
    if (cronTime !== 'off') {
      const job = CronJob.from({
        cronTime,
        timeZone: 'UTC',
        // refresh() never rejects: failures are logged and served from stored rates.
        onTick: () => void this.fx.refresh(),
        start: true,
      });
      this.registry.addCronJob(FX_REFRESH_JOB, job);
      this.logger.log(
        `FX refresh scheduled "${cronTime}" UTC, next run ${job.nextDate().toUTC().toISO()}`,
      );
    }

    if (this.config.get('FX_REFRESH_ON_BOOT', { infer: true })) {
      // Not awaited: startup must not wait on, or fail because of, the provider.
      void this.fx.refresh();
    }
  }
}
