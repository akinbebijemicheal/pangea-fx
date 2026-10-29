import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsRepository } from './transactions.repository.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  imports: [WalletsModule],
  controllers: [TransactionsController],
  providers: [TransactionsRepository, TransactionsService],
  exports: [TransactionsRepository],
})
export class TransactionsModule {}
