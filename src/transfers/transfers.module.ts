import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { TransfersController } from './transfers.controller.js';

@Module({
  imports: [LedgerModule],
  controllers: [TransfersController],
})
export class TransfersModule {}
