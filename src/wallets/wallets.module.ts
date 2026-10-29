import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { BalancesRepository } from './balances.repository.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsRepository } from './wallets.repository.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [FxModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletsRepository, BalancesRepository],
  exports: [WalletsService, WalletsRepository, BalancesRepository],
})
export class WalletsModule {}
