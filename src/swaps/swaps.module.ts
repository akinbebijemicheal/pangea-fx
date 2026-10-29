import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { SwapsController } from './swaps.controller.js';

@Module({
  imports: [LedgerModule],
  controllers: [SwapsController],
})
export class SwapsModule {}
