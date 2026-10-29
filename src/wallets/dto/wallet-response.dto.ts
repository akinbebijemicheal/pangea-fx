import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import type { RateSource } from '../../fx/fx.types.js';

export class BalanceDto {
  @ApiProperty({ enum: CURRENCIES, example: 'cNGN' })
  currency!: Currency;

  @ApiProperty({
    example: '150000.00000000',
    description: 'Decimal string with 8 decimal places. Never a JSON number, to avoid float loss.',
  })
  amount!: string;
}

export class WalletDto {
  @ApiProperty({ format: 'uuid', example: '3f1c2b9e-5d7a-4c1e-9b8a-2a6f0e4d1c3b' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ada@example.com' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+2348031234567' })
  phone!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [BalanceDto], description: 'One entry per supported stablecoin.' })
  balances!: BalanceDto[];
}

export class ValuedBalanceDto extends BalanceDto {
  @ApiProperty({
    example: '96.77419354',
    description: 'USD equivalent at the current rate, rounded down to 8 dp',
  })
  usdValue!: string;
}

export class ValuationDto {
  @ApiProperty({
    enum: ['live', 'cache', 'fallback'],
    description: 'Weakest rate source used across the balances',
  })
  source!: RateSource;

  @ApiProperty({ format: 'date-time', description: 'Oldest refresh time of the rates used' })
  ratesAsOf!: string;
}

export class WalletBalancesDto {
  @ApiProperty({ format: 'uuid' })
  walletId!: string;

  @ApiProperty({ type: [ValuedBalanceDto] })
  balances!: ValuedBalanceDto[];

  @ApiProperty({
    example: '1096.77419354',
    description: 'Sum of the per-currency USD values, so the lines always add up to the total',
  })
  totalUsd!: string;

  @ApiProperty({ type: ValuationDto })
  valuation!: ValuationDto;
}
