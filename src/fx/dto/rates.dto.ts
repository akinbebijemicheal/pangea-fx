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
    type: String,
    nullable: true,
    example: 'open.er-api.com',
    description: 'Who supplied the rate; null for fixed fallback rates',
  })
  provider!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the provider published the rate (the older leg of the pair); null for fallback rates',
  })
  providerUpdatedAt!: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'When we last stored the older of the two underlying quotes',
  })
  refreshedAt!: string;
}

export class ProviderInfoDto {
  @ApiProperty({ example: 'open.er-api.com' })
  name!: string;

  @ApiProperty({ example: 'https://www.exchangerate-api.com' })
  url!: string;

  @ApiProperty({ example: 'daily', description: 'How often the provider publishes new rates' })
  updateFrequency!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Rates By Exchange Rate API' })
  attribution!: string | null;
}

export class RatesResponseDto {
  @ApiProperty({ type: ProviderInfoDto, description: 'The configured live rate provider' })
  provider!: ProviderInfoDto;

  @ApiProperty({ type: [RateDto] })
  rates!: RateDto[];
}
