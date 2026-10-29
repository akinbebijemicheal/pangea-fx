import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrenciesService } from './currencies.service.js';
import { CurrencyDto } from './dto/currency-response.dto.js';

@ApiTags('currencies')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ApiOperation({ summary: 'List supported stablecoins' })
  @ApiOkResponse({ type: [CurrencyDto] })
  findAll(): Promise<CurrencyDto[]> {
    return this.currencies.findAll();
  }
}
