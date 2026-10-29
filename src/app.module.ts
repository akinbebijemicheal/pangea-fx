import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DepositsModule } from './deposits/deposits.module.js';
import { FxModule } from './fx/fx.module.js';
import { HealthModule } from './health/health.module.js';
import { SwapsModule } from './swaps/swaps.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { WalletsModule } from './wallets/wallets.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    CurrenciesModule,
    FxModule,
    WalletsModule,
    DepositsModule,
    SwapsModule,
    TransfersModule,
    TransactionsModule,
    IdempotencyModule,
  ],
})
export class AppModule {}
