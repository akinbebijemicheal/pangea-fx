import { Module } from '@nestjs/common';
import { TransactionsRepository } from './transactions.repository.js';

@Module({
  providers: [TransactionsRepository],
  exports: [TransactionsRepository],
})
export class TransactionsModule {}
