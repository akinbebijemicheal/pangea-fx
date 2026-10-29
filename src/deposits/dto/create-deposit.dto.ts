import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { IsMoneyAmount } from '../../common/money-amount.validator.js';

export class CreateDepositDto {
  @ApiProperty({ enum: CURRENCIES, example: 'cNGN' })
  @IsIn(CURRENCIES, { message: `currency must be one of: ${CURRENCIES.join(', ')}` })
  currency!: Currency;

  @ApiProperty({
    example: '150000.50',
    description: 'Positive decimal string, at most 8 decimal places. JSON numbers are rejected.',
  })
  @IsMoneyAmount()
  amount!: string;
}
