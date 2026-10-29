import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { Money, toRateString } from '../../common/money.js';
import type { RateSource } from '../../fx/fx.types.js';
import {
  TRANSACTION_TYPES,
  type TransactionRow,
  type TransactionType,
} from '../transaction.types.js';

export class TransactionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES })
  type!: TransactionType;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Sending wallet; null for deposits, which come from outside the system',
  })
  sourceWalletId!: string | null;

  @ApiProperty({ format: 'uuid', description: 'Receiving wallet' })
  destinationWalletId!: string;

  @ApiProperty({ enum: CURRENCIES })
  sourceCurrency!: Currency;

  @ApiProperty({ example: '100.00000000', description: 'Amount debited, 8 dp decimal string' })
  sourceAmount!: string;

  @ApiProperty({ enum: CURRENCIES })
  destinationCurrency!: Currency;

  @ApiProperty({ example: '150000.00000000', description: 'Amount credited, 8 dp decimal string' })
  destinationAmount!: string;

  @ApiProperty({
    example: '1500',
    description: 'Rate applied: 1 source unit = rate destination units. "1" when no conversion.',
  })
  rate!: string;

  @ApiProperty({
    enum: ['live', 'cache', 'fallback'],
    nullable: true,
    description: 'Where the applied FX rate came from; null when no conversion happened',
  })
  rateSource!: RateSource | null;

  @ApiProperty({ type: String, nullable: true, example: 'open.er-api.com' })
  rateProvider!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  rateRefreshedAt!: string | null;

  @ApiProperty({ description: 'The Idempotency-Key the transaction was created with' })
  idempotencyKey!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export function toTransactionDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    type: row.type,
    sourceWalletId: row.source_wallet_id,
    destinationWalletId: row.destination_wallet_id,
    sourceCurrency: row.source_currency,
    sourceAmount: row.source_amount,
    destinationCurrency: row.destination_currency,
    destinationAmount: row.destination_amount,
    rate: toRateString(new Money(row.rate)),
    rateSource: row.rate_source,
    rateProvider: row.rate_provider,
    rateRefreshedAt: row.rate_refreshed_at?.toISOString() ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  };
}
