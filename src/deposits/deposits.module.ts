import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { DepositsController } from './deposits.controller.js';
import { DepositsService } from './deposits.service.js';

@Module({
  imports: [WalletsModule, TransactionsModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
