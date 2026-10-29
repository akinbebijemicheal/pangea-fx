import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { DiffersFrom } from '../../common/differs-from.validator.js';
import { IsMoneyAmount } from '../../common/money-amount.validator.js';

const CURRENCY_MESSAGE = `must be one of: ${CURRENCIES.join(', ')}`;

export class CreateSwapDto {
  @ApiProperty({ enum: CURRENCIES, example: 'USDx', description: 'Currency to sell' })
  @IsIn(CURRENCIES, { message: `fromCurrency ${CURRENCY_MESSAGE}` })
  fromCurrency!: Currency;

  @ApiProperty({ enum: CURRENCIES, example: 'cNGN', description: 'Currency to buy' })
  // Decorators run bottom-up and the pipe stops at the first failure.
  @DiffersFrom('fromCurrency')
  @IsIn(CURRENCIES, { message: `toCurrency ${CURRENCY_MESSAGE}` })
  toCurrency!: Currency;

  @ApiProperty({
    example: '100.00',
    description:
      'Amount of fromCurrency to sell. Positive decimal string, at most 8 decimal places. The amount received is amount x rate, rounded down to 8 dp.',
  })
  @IsMoneyAmount()
  amount!: string;
}
