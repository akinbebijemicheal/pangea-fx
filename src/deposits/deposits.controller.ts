import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IDEMPOTENCY_HEADER } from '../idempotency/idempotency.interceptor.js';
import { Idempotent } from '../idempotency/idempotent.decorator.js';
import { TransactionDto } from '../transactions/dto/transaction.dto.js';
import { DepositsService } from './deposits.service.js';
import { CreateDepositDto } from './dto/create-deposit.dto.js';

@ApiTags('deposits')
@Controller('wallets/:walletId/deposits')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post()
  @Idempotent()
  @ApiOperation({
    summary: 'Deposit funds into a wallet (simulated)',
    description: 'Credits the balance immediately and records a deposit transaction.',
  })
  @ApiCreatedResponse({ type: TransactionDto })
  @ApiBadRequestResponse({
    description: 'Invalid amount or currency, malformed wallet id, or missing Idempotency-Key',
  })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  create(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: CreateDepositDto,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey: string,
  ): Promise<TransactionDto> {
    return this.deposits.deposit(walletId, dto, idempotencyKey);
  }
}
