import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { FX_REFRESH_JOB, FxRefreshScheduler } from './fx-refresh.scheduler.js';
import type { FxService } from './fx.service.js';

function setup(env: Partial<EnvironmentVariables>) {
  const jobs = new Map<string, CronJob>();
  const registry = {
    addCronJob: vi.fn((name: string, job: CronJob) => jobs.set(name, job)),
  } as unknown as SchedulerRegistry;
  const refresh = vi.fn(() => Promise.resolve());
  const config = {
    get: (key: keyof EnvironmentVariables) => env[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const scheduler = new FxRefreshScheduler({ refresh } as unknown as FxService, registry, config);
  return { scheduler, jobs, refresh };
}

describe('FxRefreshScheduler', () => {
  const started: CronJob[] = [];

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  afterEach(() => {
    for (const job of started.splice(0)) void job.stop();
  });

  it('registers a daily UTC cron job that refreshes rates on each tick', async () => {
    const { scheduler, jobs, refresh } = setup({
      FX_REFRESH_CRON: '10 0 * * *',
      FX_REFRESH_ON_BOOT: false,
    });
    scheduler.onApplicationBootstrap();

    const job = jobs.get(FX_REFRESH_JOB);
    expect(job).toBeDefined();
    started.push(job!);
    expect(job!.isActive).toBe(true);
    const next = job!.nextDate().toUTC();
    expect([next.hour, next.minute]).toEqual([0, 10]);

    expect(refresh).not.toHaveBeenCalled();
    await job!.fireOnTick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('registers nothing when the cron is "off"', () => {
    const { scheduler, jobs } = setup({ FX_REFRESH_CRON: 'off', FX_REFRESH_ON_BOOT: false });
    scheduler.onApplicationBootstrap();
    expect(jobs.size).toBe(0);
  });

  it('refreshes once at boot when enabled, without waiting for it', () => {
    const { scheduler, refresh } = setup({ FX_REFRESH_CRON: 'off', FX_REFRESH_ON_BOOT: true });
    refresh.mockReturnValue(new Promise(() => undefined)); // never settles
    expect(scheduler.onApplicationBootstrap()).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh at boot when disabled', () => {
    const { scheduler, refresh } = setup({ FX_REFRESH_CRON: 'off', FX_REFRESH_ON_BOOT: false });
    scheduler.onApplicationBootstrap();
    expect(refresh).not.toHaveBeenCalled();
  });
});
