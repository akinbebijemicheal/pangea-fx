import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CURRENCIES } from '../common/currency.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';
import type { BalanceDto, WalletBalancesDto, WalletDto } from './dto/wallet-response.dto.js';
import type { BalanceRow, WalletRow } from './wallet.types.js';
import { WalletsRepository } from './wallets.repository.js';

@Injectable()
export class WalletsService {
  constructor(private readonly wallets: WalletsRepository) {}

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

  async getBalances(id: string): Promise<WalletBalancesDto> {
    await this.requireWallet(id);
    return { walletId: id, balances: this.toBalanceDtos(await this.wallets.findBalances(id)) };
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

  /** Stable currency order regardless of row order from the DB. */
  private toBalanceDtos(rows: BalanceRow[]): BalanceDto[] {
    const byCurrency = new Map(rows.map((r) => [r.currency, r.amount]));
    return CURRENCIES.map((currency) => ({
      currency,
      amount: byCurrency.get(currency) ?? '0.00000000',
    }));
  }
}
