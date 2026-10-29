import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller.js';
import { CurrenciesRepository } from './currencies.repository.js';
import { CurrenciesService } from './currencies.service.js';

@Module({
  controllers: [CurrenciesController],
  providers: [CurrenciesService, CurrenciesRepository],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
