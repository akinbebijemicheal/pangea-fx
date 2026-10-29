import { Injectable, NotFoundException } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import { CURRENCIES, type Currency } from '../common/currency.js';
import { convert, Money, toAmountString } from '../common/money.js';
import { derivePair, type QuoteSet } from '../fx/fx-math.js';
import { FxService } from '../fx/fx.service.js';
import { worseSource } from '../fx/fx.types.js';
import { WalletsRepository } from '../wallets/wallets.repository.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { toTransactionDto, type TransactionDto } from './dto/transaction.dto.js';
import {
  type CurrencyTotalDto,
  DEFAULT_PAGE_SIZE,
  type Direction,
  type HistorySummaryDto,
  type WalletTransactionsPageDto,
  type WalletTransactionsQueryDto,
} from './dto/wallet-transactions.dto.js';
import { TransactionStatsRepository, type StatsRow } from './transaction-stats.repository.js';
import type { TransactionRow } from './transaction.types.js';
import { TransactionsRepository } from './transactions.repository.js';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly stats: TransactionStatsRepository,
    private readonly wallets: WalletsRepository,
    private readonly fx: FxService,
  ) {}

  async findById(id: string): Promise<TransactionDto> {
    const row = await this.transactions.findById(id);
    if (!row) throw new NotFoundException(`Transaction ${id} not found`);
    return toTransactionDto(row);
  }

  /**
   * One page of history plus pagination and analytics. The page is LIMITed
   * index scans; the summary is a few pre-aggregated rows; the three reads run
   * in parallel. Nothing here scans the wallet's full history.
   */
  async listForWallet(
    walletId: string,
    query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionsPageDto> {
    // Decode first: a bad cursor is a 400 regardless of the wallet.
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const id = walletId.toLowerCase();
    if (!(await this.wallets.findById(id))) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filter = { type: query.type, currency: query.currency };
    const [rows, statsRows, quotes] = await Promise.all([
      // One extra row tells us whether another page exists.
      this.transactions.findHistory({ walletId: id, ...filter, limit: limit + 1, after }),
      this.stats.find(id, filter),
      this.fx.getQuotes(),
    ]);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = rows.length > limit;
    const summary = summarise(statsRows, quotes);
    return {
      data: page.map((row) => ({ ...toTransactionDto(row), direction: directionFor(row, id) })),
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.created_at_cursor, id: last.id }) : null,
      pagination: {
        limit,
        totalCount: summary.transactionCount,
        totalPages: Math.ceil(summary.transactionCount / limit),
        hasMore,
      },
      summary,
    };
  }
}

function directionFor(row: TransactionRow, walletId: string): Direction {
  if (row.type === 'swap') return 'self';
  return row.source_wallet_id === walletId ? 'out' : 'in';
}

/**
 * Folds the wallet's aggregate rows into counts and per-currency debit and
 * credit totals. From the wallet's point of view, "out" and "self" rows debit
 * the source currency, and "in" and "self" rows credit the destination currency.
 */
export function summarise(rows: StatsRow[], quotes: QuoteSet): HistorySummaryDto {
  const countByType = { deposit: 0, swap: 0, transfer: 0 };
  const debits = new Map<Currency, Decimal>(CURRENCIES.map((c) => [c, new Money(0)]));
  const credits = new Map<Currency, Decimal>(CURRENCIES.map((c) => [c, new Money(0)]));

  for (const row of rows) {
    countByType[row.type] += Number(row.tx_count);
    if (row.direction !== 'in') {
      debits.set(row.source_currency, debits.get(row.source_currency)!.plus(row.source_total));
    }
    if (row.direction !== 'out') {
      credits.set(
        row.destination_currency,
        credits.get(row.destination_currency)!.plus(row.destination_total),
      );
    }
  }

  const pairs = CURRENCIES.map((c) => derivePair(quotes, c, 'USDx'));
  const value = (totals: Map<Currency, Decimal>) => {
    let usd = new Money(0);
    const lines: CurrencyTotalDto[] = CURRENCIES.map((currency, i) => {
      const amount = totals.get(currency)!;
      const usdValue = convert(amount, pairs[i]!.rate);
      usd = usd.plus(usdValue);
      return { currency, amount: toAmountString(amount), usdValue: toAmountString(usdValue) };
    });
    return { lines, usd };
  };
  const debit = value(debits);
  const credit = value(credits);

  return {
    transactionCount: countByType.deposit + countByType.swap + countByType.transfer,
    countByType,
    debits: debit.lines,
    credits: credit.lines,
    totalDebitUsd: toAmountString(debit.usd),
    totalCreditUsd: toAmountString(credit.usd),
    netUsd: toAmountString(credit.usd.minus(debit.usd)),
    valuation: {
      source: pairs.map((p) => p.source).reduce(worseSource, 'live'),
      ratesAsOf: new Date(Math.min(...pairs.map((p) => p.refreshedAt.getTime()))).toISOString(),
      provider: pairs.every((p) => p.provider === pairs[0]?.provider)
        ? (pairs[0]?.provider ?? null)
        : null,
    },
  };
}
