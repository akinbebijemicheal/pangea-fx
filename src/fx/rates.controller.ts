import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { toRateString } from '../common/money.js';
import { RatesQueryDto, type RateDto, RatesResponseDto } from './dto/rates.dto.js';
import { derivePair } from './fx-math.js';
import type { PairRate } from './fx.types.js';
import { FxService } from './fx.service.js';

@ApiTags('rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly fx: FxService) {}

  @Get()
  @ApiOperation({
    summary: 'Current conversion rates between supported stablecoins',
    description:
      'Without filters returns all 20 ordered pairs. `from` and/or `to` narrow the list; both together return a single pair.',
  })
  @ApiOkResponse({ type: RatesResponseDto })
  @ApiBadRequestResponse({ description: 'Unsupported currency in from/to' })
  async list(@Query() query: RatesQueryDto): Promise<RatesResponseDto> {
    let pairs: PairRate[];
    if (query.from && query.to) {
      pairs = [derivePair(await this.fx.getQuotes(), query.from, query.to)];
    } else {
      pairs = (await this.fx.listRates()).filter(
        (p) => (!query.from || p.from === query.from) && (!query.to || p.to === query.to),
      );
    }
    return { provider: this.fx.providerInfo, rates: pairs.map(toRateDto) };
  }
}

function toRateDto(p: PairRate): RateDto {
  return {
    from: p.from,
    to: p.to,
    rate: toRateString(p.rate),
    source: p.source,
    provider: p.provider,
    providerUpdatedAt: p.providerUpdatedAt?.toISOString() ?? null,
    refreshedAt: p.refreshedAt.toISOString(),
  };
}
