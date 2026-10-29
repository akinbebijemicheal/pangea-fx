import { Injectable, NotFoundException } from '@nestjs/common';
import { WalletsRepository } from '../wallets/wallets.repository.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { toTransactionDto, type TransactionDto } from './dto/transaction.dto.js';
import type {
  Direction,
  WalletTransactionsPageDto,
  WalletTransactionsQueryDto,
} from './dto/wallet-transactions.dto.js';
import type { TransactionRow } from './transaction.types.js';
import { TransactionsRepository } from './transactions.repository.js';

export const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly wallets: WalletsRepository,
  ) {}

  async findById(id: string): Promise<TransactionDto> {
    const row = await this.transactions.findById(id);
    if (!row) throw new NotFoundException(`Transaction ${id} not found`);
    return toTransactionDto(row);
  }

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
    // One extra row tells us whether another page exists without a COUNT.
    const rows = await this.transactions.findHistory({
      walletId: id,
      type: query.type,
      currency: query.currency,
      limit: limit + 1,
      after,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({ ...toTransactionDto(row), direction: directionFor(row, id) })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.created_at_cursor, id: last.id })
          : null,
    };
  }
}

function directionFor(row: TransactionRow, walletId: string): Direction {
  if (row.type === 'swap') return 'self';
  return row.source_wallet_id === walletId ? 'out' : 'in';
}
