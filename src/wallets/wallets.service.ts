import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { convert, Money, toAmountString } from '../common/money.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { derivePair } from '../fx/fx-math.js';
import { FxService } from '../fx/fx.service.js';
import { worseSource } from '../fx/fx.types.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';
import { LOOKUP_ONE_OF_MESSAGE, type LookupWalletQueryDto } from './dto/lookup-wallet.dto.js';
import type { BalanceDto, WalletBalancesDto, WalletDto } from './dto/wallet-response.dto.js';
import type { BalanceRow, WalletRow } from './wallet.types.js';
import { WalletsRepository } from './wallets.repository.js';

@Injectable()
export class WalletsService {
  constructor(
    private readonly wallets: WalletsRepository,
    private readonly fx: FxService,
  ) {}

  async create(dto: CreateWalletDto): Promise<WalletDto> {
    let wallet: WalletRow;
    try {
      wallet = await this.wallets.create({ email: dto.email ?? null, phone: dto.phone ?? null });
    } catch (err) {
      // The unique constraints are the source of truth, so concurrent duplicate
      // requests resolve to exactly one 201 and the rest 409.
      if (isUniqueViolation(err, 'wallets_email_unique')) {
        throw new ConflictException('A wallet already exists for this email');
      }
      if (isUniqueViolation(err, 'wallets_phone_unique')) {
        throw new ConflictException('A wallet already exists for this phone number');
      }
      throw err;
    }
    return this.toWalletDto(wallet, await this.wallets.findBalances(wallet.id));
  }

  async findById(id: string): Promise<WalletDto> {
    const wallet = await this.requireWallet(id);
    return this.toWalletDto(wallet, await this.wallets.findBalances(id));
  }

  async lookup(query: LookupWalletQueryDto): Promise<WalletDto> {
    // The DTO guarantees at least one; this enforces "not both".
    if (query.email !== undefined && query.phone !== undefined) {
      throw new BadRequestException([LOOKUP_ONE_OF_MESSAGE]);
    }
    const contact = query.email !== undefined ? { email: query.email } : { phone: query.phone! };
    const wallet = await this.wallets.findByContact(contact);
    if (!wallet) throw new NotFoundException('No wallet found for this contact');
    return this.toWalletDto(wallet, await this.wallets.findBalances(wallet.id));
  }

  /**
   * Balances with a USD value per line and in total. Each line is converted at
   * the current currency -> USDx rate and rounded down; the total is the sum of
   * the rounded lines so the response always adds up.
   */
  async getBalances(id: string): Promise<WalletBalancesDto> {
    await this.requireWallet(id);
    const [rows, quotes] = await Promise.all([this.wallets.findBalances(id), this.fx.getQuotes()]);
    let total = new Money(0);
    const pairs = rows.map((r) => derivePair(quotes, r.currency, 'USDx'));
    const balances = rows.map((r, i) => {
      const usd = convert(new Money(r.amount), pairs[i]!.rate);
      total = total.plus(usd);
      return { currency: r.currency, amount: r.amount, usdValue: toAmountString(usd) };
    });
    return {
      walletId: id,
      balances,
      totalUsd: toAmountString(total),
      valuation: {
        source: pairs.map((p) => p.source).reduce(worseSource, 'live'),
        ratesAsOf: new Date(Math.min(...pairs.map((p) => p.refreshedAt.getTime()))).toISOString(),
        provider: pairs.every((p) => p.provider === pairs[0]?.provider)
          ? (pairs[0]?.provider ?? null)
          : null,
      },
    };
  }

  private async requireWallet(id: string): Promise<WalletRow> {
    const wallet = await this.wallets.findById(id);
    if (!wallet) throw new NotFoundException(`Wallet ${id} not found`);
    return wallet;
  }

  private toWalletDto(wallet: WalletRow, balances: BalanceRow[]): WalletDto {
    return {
      id: wallet.id,
      email: wallet.email,
      phone: wallet.phone,
      createdAt: wallet.created_at.toISOString(),
      balances: this.toBalanceDtos(balances),
    };
  }

  private toBalanceDtos(rows: BalanceRow[]): BalanceDto[] {
    return rows.map((r) => ({ currency: r.currency, amount: r.amount }));
  }
}
