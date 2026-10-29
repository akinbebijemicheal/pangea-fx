import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { TRANSACTION_TYPES, type TransactionType } from '../transaction.types.js';
import { TransactionDto } from './transaction.dto.js';

export const DIRECTIONS = ['in', 'out', 'self'] as const;
export type Direction = (typeof DIRECTIONS)[number];

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

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer between 1 and 100' })
  @Min(1, { message: 'limit must be an integer between 1 and 100' })
  @Max(100, { message: 'limit must be an integer between 1 and 100' })
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

export class WalletTransactionsPageDto {
  @ApiProperty({ type: [WalletTransactionDto], description: 'Newest first' })
  data!: WalletTransactionDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` to get the next page; null when there are no more',
  })
  nextCursor!: string | null;
}
