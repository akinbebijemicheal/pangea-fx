import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CURRENCIES, type Currency } from '../../common/currency.js';
import type { RateSource } from '../fx.types.js';

const SOURCES: RateSource[] = ['live', 'cache', 'fallback'];

export class RatesQueryDto {
  @ApiPropertyOptional({
    enum: CURRENCIES,
    description: 'Only pairs converting from this currency',
  })
  @IsOptional()
  @IsIn(CURRENCIES)
  from?: Currency;

  @ApiPropertyOptional({ enum: CURRENCIES, description: 'Only pairs converting to this currency' })
  @IsOptional()
  @IsIn(CURRENCIES)
  to?: Currency;
}

export class RateDto {
  @ApiProperty({ enum: CURRENCIES, example: 'USDx' })
  from!: Currency;

  @ApiProperty({ enum: CURRENCIES, example: 'cNGN' })
  to!: Currency;

  @ApiProperty({
    example: '1550',
    description:
      '1 unit of `from` buys this many units of `to`. Decimal string, 15 significant digits.',
  })
  rate!: string;

  @ApiProperty({
    enum: SOURCES,
    description:
      'live: fetched within the cache TTL. cache: last live rate, provider currently failing. fallback: fixed seed rate, no live rate yet.',
  })
  source!: RateSource;

  @ApiProperty({
    format: 'date-time',
    description: 'When the older of the two underlying quotes was stored',
  })
  refreshedAt!: string;
}

export class RatesResponseDto {
  @ApiProperty({ type: [RateDto] })
  rates!: RateDto[];
}
