import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../common/currency.js';

export class CurrencyDto {
  @ApiProperty({ enum: CURRENCIES, example: 'cNGN' })
  code!: Currency;

  @ApiProperty({ example: 'Nigerian Naira Coin' })
  name!: string;

  @ApiProperty({
    example: 'NGN',
    description: 'ISO 4217 code of the fiat currency it is pegged to',
  })
  fiatCode!: string;
}
