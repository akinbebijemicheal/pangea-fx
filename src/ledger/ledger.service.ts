import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Currency } from '../common/currency.js';
import { convert, Money, toAmountString } from '../common/money.js';
import { hasPgCode, PG_NUMERIC_OVERFLOW } from '../database/pg-errors.js';
import { TransactionManager } from '../database/transaction-manager.js';
import { derivePair } from '../fx/fx-math.js';
import { FxService } from '../fx/fx.service.js';
import type { PairRate } from '../fx/fx.types.js';
import { toTransactionDto, type TransactionDto } from '../transactions/dto/transaction.dto.js';
import { TransactionsRepository } from '../transactions/transactions.repository.js';
import { balanceKey, BalancesRepository } from '../wallets/balances.repository.js';

export interface Movement {
  type: 'swap' | 'transfer';
  sourceWalletId: string;
  destinationWalletId: string;
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  /** Amount leaving the source balance, in the source currency. */
  amount: Decimal;
  idempotencyKey: string;
}

/**
 * Moves value between two balances: a swap is a movement within one wallet,
 * a transfer between two. In one database transaction it:
 *
 * 1. takes the rate from stored quotes (never calls the provider while
 *    holding locks); same-currency movements use exactly 1,
 * 2. locks both balance rows in a fixed order (deadlock-free),
 * 3. checks funds against the locked amount,
 * 4. debits, credits amount x rate rounded down, and records the transaction.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly tm: TransactionManager,
    private readonly fx: FxService,
    private readonly balances: BalancesRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  async move(movement: Movement): Promise<TransactionDto> {
    // Postgres returns UUIDs in lower case; lock results are keyed by them.
    const m: Movement = {
      ...movement,
      sourceWalletId: movement.sourceWalletId.toLowerCase(),
      destinationWalletId: movement.destinationWalletId.toLowerCase(),
    };
    const pair = await this.rateFor(m.sourceCurrency, m.destinationCurrency);
    const credited = convert(m.amount, pair?.rate ?? new Money(1));
    if (credited.isZero()) {
      throw new UnprocessableEntityException(
        `amount is too small: ${m.amount.toFixed()} ${m.sourceCurrency} converts to 0 ${m.destinationCurrency}`,
      );
    }

    return this.tm.run(async () => {
      const source = { walletId: m.sourceWalletId, currency: m.sourceCurrency };
      const destination = { walletId: m.destinationWalletId, currency: m.destinationCurrency };
      const locked = await this.balances.lock([source, destination]);

      const available = locked.get(balanceKey(source));
      if (available === undefined) {
        throw new NotFoundException(`Wallet ${m.sourceWalletId} not found`);
      }
      if (!locked.has(balanceKey(destination))) {
        throw new NotFoundException(`Destination wallet ${m.destinationWalletId} not found`);
      }
      if (new Money(available).lt(m.amount)) {
        throw new UnprocessableEntityException(
          `Insufficient ${m.sourceCurrency} balance: available ${toAmountString(available)}, requested ${toAmountString(m.amount)}`,
        );
      }

      await this.balances.debit(source.walletId, source.currency, m.amount);
      try {
        await this.balances.credit(destination.walletId, destination.currency, credited);
      } catch (err) {
        if (hasPgCode(err, PG_NUMERIC_OVERFLOW)) {
          throw new UnprocessableEntityException(
            `This would take the ${m.destinationCurrency} balance above the maximum supported amount`,
          );
        }
        throw err;
      }

      const row = await this.transactions.insert({
        type: m.type,
        source_wallet_id: m.sourceWalletId,
        destination_wallet_id: m.destinationWalletId,
        source_currency: m.sourceCurrency,
        source_amount: m.amount.toFixed(),
        destination_currency: m.destinationCurrency,
        destination_amount: credited.toFixed(),
        rate: pair ? pair.rate.toFixed() : '1',
        rate_source: pair?.source ?? null,
        rate_provider: pair?.provider ?? null,
        rate_refreshed_at: pair?.refreshedAt ?? null,
        idempotency_key: m.idempotencyKey,
      });
      return toTransactionDto(row);
    });
  }

  /** Null when no conversion happens. */
  private async rateFor(from: Currency, to: Currency): Promise<PairRate | null> {
    if (from === to) return null;
    return derivePair(await this.fx.getQuotes({ refresh: false }), from, to);
  }
}
