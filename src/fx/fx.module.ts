import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { FxRefreshScheduler } from './fx-refresh.scheduler.js';
import { FxRatesRepository } from './fx-rates.repository.js';
import { FxService } from './fx.service.js';
import { CLOCK, type Clock, FX_OPTIONS, FX_RATE_PROVIDER, type FxOptions } from './fx.types.js';
import { OpenErApiProvider } from './open-er-api.provider.js';
import { RatesController } from './rates.controller.js';

type Config = ConfigService<EnvironmentVariables, true>;

@Module({
  imports: [CurrenciesModule],
  controllers: [RatesController],
  providers: [
    FxService,
    FxRatesRepository,
    FxRefreshScheduler,
    {
      provide: FX_RATE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: Config) =>
        new OpenErApiProvider(
          config.get('FX_PROVIDER_URL', { infer: true }),
          config.get('FX_TIMEOUT_MS', { infer: true }),
        ),
    },
    {
      provide: FX_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: Config): FxOptions => ({
        cacheTtlMs: config.get('FX_CACHE_TTL_SECONDS', { infer: true }) * 1000,
        retryBackoffMs: config.get('FX_RETRY_BACKOFF_SECONDS', { infer: true }) * 1000,
      }),
    },
    { provide: CLOCK, useValue: (() => new Date()) satisfies Clock },
  ],
  exports: [FxService],
})
export class FxModule {}
