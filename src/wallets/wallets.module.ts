import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller.js';
import { WalletsRepository } from './wallets.repository.js';
import { WalletsService } from './wallets.service.js';

@Module({
  controllers: [WalletsController],
  providers: [WalletsService, WalletsRepository],
  exports: [WalletsService],
})
export class WalletsModule {}
