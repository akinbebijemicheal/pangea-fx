import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUniqueViolation } from '../database/pg-errors.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';
import { LOOKUP_ONE_OF_MESSAGE, type LookupWalletQueryDto } from './dto/lookup-wallet.dto.js';
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

  private toBalanceDtos(rows: BalanceRow[]): BalanceDto[] {
    return rows.map((r) => ({ currency: r.currency, amount: r.amount }));
  }
}
