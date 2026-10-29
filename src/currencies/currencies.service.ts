import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { CURRENCIES } from '../common/currency.js';
import { CurrenciesRepository } from './currencies.repository.js';
import type { CurrencyDto } from './dto/currency-response.dto.js';

@Injectable()
export class CurrenciesService implements OnApplicationBootstrap {
  constructor(private readonly currencies: CurrenciesRepository) {}

  /**
   * Fails fast if the `currencies` table and the compile-time CURRENCIES list
   * disagree, since validation would then accept a currency the DB rejects
   * (or the reverse). Runs after DatabaseModule has applied migrations.
   */
  async onApplicationBootstrap(): Promise<void> {
    const inDb = (await this.currencies.findAll()).map((c) => c.code);
    const inCode = [...CURRENCIES];
    if (inDb.length !== inCode.length || inDb.some((code, i) => code !== inCode[i])) {
      throw new Error(
        `currencies table [${inDb.join(', ')}] does not match CURRENCIES [${inCode.join(', ')}]`,
      );
    }
  }

  async findAll(): Promise<CurrencyDto[]> {
    return (await this.currencies.findAll()).map((c) => ({
      code: c.code,
      name: c.name,
      fiatCode: c.fiat_code,
    }));
  }
}
