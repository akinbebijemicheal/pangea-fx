import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Money } from '../common/money.js';
import { IDEMPOTENCY_HEADER } from '../idempotency/idempotency.interceptor.js';
import { Idempotent } from '../idempotency/idempotent.decorator.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { TransactionDto } from '../transactions/dto/transaction.dto.js';
import { CreateSwapDto } from './dto/create-swap.dto.js';

@ApiTags('swaps')
@Controller('wallets/:walletId/swaps')
export class SwapsController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  @Idempotent()
  @ApiOperation({
    summary: 'Swap one stablecoin for another inside a wallet',
    description:
      'Sells `amount` of fromCurrency at the current stored rate and credits amount x rate (rounded down) of toCurrency. Rejected with 422 if the balance is insufficient. The applied rate, its source and provider are recorded on the transaction.',
  })
  @ApiCreatedResponse({ type: TransactionDto })
  @ApiBadRequestResponse({
    description:
      'Invalid amount or currency, same currency on both sides, malformed wallet id, or missing Idempotency-Key',
  })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  create(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: CreateSwapDto,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey: string,
  ): Promise<TransactionDto> {
    return this.ledger.move({
      type: 'swap',
      sourceWalletId: walletId,
      destinationWalletId: walletId,
      sourceCurrency: dto.fromCurrency,
      destinationCurrency: dto.toCurrency,
      amount: new Money(dto.amount),
      idempotencyKey,
    });
  }
}
