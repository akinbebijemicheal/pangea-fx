import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransactionStatsRepository } from './transaction-stats.repository.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsRepository } from './transactions.repository.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  imports: [WalletsModule, FxModule],
  controllers: [TransactionsController],
  providers: [TransactionsRepository, TransactionStatsRepository, TransactionsService],
  exports: [TransactionsRepository],
})
export class TransactionsModule {}
