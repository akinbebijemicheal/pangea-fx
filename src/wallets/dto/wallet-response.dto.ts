import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../common/currency.js';

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

export class WalletBalancesDto {
  @ApiProperty({ format: 'uuid' })
  walletId!: string;

  @ApiProperty({ type: [BalanceDto] })
  balances!: BalanceDto[];
}
