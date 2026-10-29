import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { ValuationDto } from '../../wallets/dto/wallet-response.dto.js';
import { TRANSACTION_TYPES, type TransactionType } from '../transaction.types.js';
import { TransactionDto } from './transaction.dto.js';

export const DIRECTIONS = ['in', 'out', 'self'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DEFAULT_PAGE_SIZE = 10;
/**
 * A page is fetched with LIMITed index scans, so its cost grows with the page
 * size; the cap keeps one request from pulling an entire history into memory.
 */
export const MAX_PAGE_SIZE = 1000;
const LIMIT_MESSAGE = `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`;

export class WalletTransactionsQueryDto {
  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES, { message: `type must be one of: ${TRANSACTION_TYPES.join(', ')}` })
  type?: TransactionType;

  @ApiPropertyOptional({
    enum: CURRENCIES,
    description: 'Only movements where this currency was debited or credited',
  })
  @IsOptional()
  @IsIn(CURRENCIES, { message: `currency must be one of: ${CURRENCIES.join(', ')}` })
  currency?: Currency;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Transactions per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  @Max(MAX_PAGE_SIZE, { message: LIMIT_MESSAGE })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor: pass `nextCursor` from the previous page to get the next one',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class WalletTransactionDto extends TransactionDto {
  @ApiProperty({
    enum: DIRECTIONS,
    description:
      'Relative to the wallet being listed: in (deposit or transfer received), out (transfer sent), self (swap)',
  })
  direction!: Direction;
}

export class PaginationDto {
  @ApiProperty({ example: 10, description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ example: 42, description: 'Transactions matching the filters, across all pages' })
  totalCount!: number;

  @ApiProperty({ example: 5, description: 'ceil(totalCount / limit); 0 when there are none' })
  totalPages!: number;

  @ApiProperty({ description: 'Whether another page follows this one' })
  hasMore!: boolean;
}

export class CountByTypeDto {
  @ApiProperty({ example: 3 })
  deposit!: number;

  @ApiProperty({ example: 2 })
  swap!: number;

  @ApiProperty({ example: 4 })
  transfer!: number;
}

export class CurrencyTotalDto {
  @ApiProperty({ enum: CURRENCIES, example: 'USDx' })
  currency!: Currency;

  @ApiProperty({ example: '120.00000000', description: 'Exact total, 8 dp decimal string' })
  amount!: string;

  @ApiProperty({
    example: '120.00000000',
    description: 'USD equivalent at current rates, rounded down to 8 dp',
  })
  usdValue!: string;
}

export class HistorySummaryDto {
  @ApiProperty({ example: 9, description: 'Transactions matching the filters' })
  transactionCount!: number;

  @ApiProperty({ type: CountByTypeDto })
  countByType!: CountByTypeDto;

  @ApiProperty({
    type: [CurrencyTotalDto],
    description:
      'Total debited from this wallet per currency (transfers sent, the sold side of swaps). One entry per supported currency.',
  })
  debits!: CurrencyTotalDto[];

  @ApiProperty({
    type: [CurrencyTotalDto],
    description:
      'Total credited to this wallet per currency (deposits, transfers received, the bought side of swaps). One entry per supported currency.',
  })
  credits!: CurrencyTotalDto[];

  @ApiProperty({ example: '120.00000000', description: 'Sum of debits[].usdValue' })
  totalDebitUsd!: string;

  @ApiProperty({ example: '600.33333333', description: 'Sum of credits[].usdValue' })
  totalCreditUsd!: string;

  @ApiProperty({
    example: '480.33333333',
    description: 'totalCreditUsd - totalDebitUsd (negative when more went out than came in)',
  })
  netUsd!: string;

  @ApiProperty({
    type: ValuationDto,
    description: 'The rates used for the USD values: current rates, not historical ones',
  })
  valuation!: ValuationDto;
}

export class WalletTransactionsPageDto {
  @ApiProperty({ type: [WalletTransactionDto], description: 'Newest first' })
  data!: WalletTransactionDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` to get the next page; null when there are no more',
  })
  nextCursor!: string | null;

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;

  @ApiProperty({
    type: HistorySummaryDto,
    description:
      'Analytics over every transaction matching the filters (all pages, not just this one). Read from running aggregates, so its cost does not grow with history length.',
  })
  summary!: HistorySummaryDto;
}
