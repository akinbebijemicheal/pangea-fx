import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { LedgerService } from './ledger.service.js';

@Module({
  imports: [FxModule, WalletsModule, TransactionsModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
