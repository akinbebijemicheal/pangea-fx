import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Money } from '../common/money.js';
import { hasPgCode, PG_NUMERIC_OVERFLOW } from '../database/pg-errors.js';
import { TransactionManager } from '../database/transaction-manager.js';
import { toTransactionDto, type TransactionDto } from '../transactions/dto/transaction.dto.js';
import { TransactionsRepository } from '../transactions/transactions.repository.js';
import { BalancesRepository } from '../wallets/balances.repository.js';
import type { CreateDepositDto } from './dto/create-deposit.dto.js';

@Injectable()
export class DepositsService {
  constructor(
    private readonly tm: TransactionManager,
    private readonly balances: BalancesRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  /** Credits the balance and records the deposit in one database transaction. */
  async deposit(
    walletId: string,
    dto: CreateDepositDto,
    idempotencyKey: string,
  ): Promise<TransactionDto> {
    const amount = new Money(dto.amount);
    return this.tm.run(async () => {
      let credited: string | undefined;
      try {
        credited = await this.balances.credit(walletId, dto.currency, amount);
      } catch (err) {
        if (hasPgCode(err, PG_NUMERIC_OVERFLOW)) {
          throw new UnprocessableEntityException(
            'Deposit would take the balance above the maximum supported amount',
          );
        }
        throw err;
      }
      // Every wallet has a row per currency, so no row means no wallet.
      if (credited === undefined) throw new NotFoundException(`Wallet ${walletId} not found`);

      const row = await this.transactions.insert({
        type: 'deposit',
        source_wallet_id: null,
        destination_wallet_id: walletId,
        source_currency: dto.currency,
        source_amount: amount.toFixed(),
        destination_currency: dto.currency,
        destination_amount: amount.toFixed(),
        rate: '1',
        rate_source: null,
        rate_provider: null,
        rate_refreshed_at: null,
        idempotency_key: idempotencyKey,
      });
      return toTransactionDto(row);
    });
  }
}
