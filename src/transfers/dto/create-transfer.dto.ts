import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import { IsMoneyAmount } from '../../common/money-amount.validator.js';

const CURRENCY_MESSAGE = `must be one of: ${CURRENCIES.join(', ')}`;

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid', description: 'Receiving wallet' })
  @IsUUID('all', { message: 'toWalletId must be a wallet id (UUID)' })
  toWalletId!: string;

  @ApiProperty({
    enum: CURRENCIES,
    example: 'USDx',
    description: 'Currency debited from the sender',
  })
  @IsIn(CURRENCIES, { message: `fromCurrency ${CURRENCY_MESSAGE}` })
  fromCurrency!: Currency;

  @ApiPropertyOptional({
    enum: CURRENCIES,
    example: 'cNGN',
    description:
      'Currency credited to the receiver. Defaults to fromCurrency; when different, the amount is converted at the current stored rate.',
  })
  @IsOptional()
  @IsIn(CURRENCIES, { message: `toCurrency ${CURRENCY_MESSAGE}` })
  toCurrency?: Currency;

  @ApiProperty({
    example: '100.00',
    description:
      'Amount debited from the sender, in fromCurrency. Positive decimal string, at most 8 decimal places. The receiver gets amount x rate, rounded down to 8 dp.',
  })
  @IsMoneyAmount()
  amount!: string;
}
