import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
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
import { CreateTransferDto } from './dto/create-transfer.dto.js';

@ApiTags('transfers')
@Controller('wallets/:walletId/transfers')
export class TransfersController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  @Idempotent()
  @ApiOperation({
    summary: 'Send stablecoins to another wallet, in the same or a different currency',
    description:
      'Debits `amount` of fromCurrency from this wallet and credits the receiver in toCurrency (default: fromCurrency). Different currencies are converted at the current stored rate. One transaction is recorded with sender, receiver, both amounts and currencies, the rate applied and a timestamp.',
  })
  @ApiCreatedResponse({ type: TransactionDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body, transfer to the same wallet, malformed wallet id, or missing Idempotency-Key',
  })
  @ApiNotFoundResponse({ description: 'Sending or receiving wallet not found' })
  create(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: CreateTransferDto,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey: string,
  ): Promise<TransactionDto> {
    // UUIDs are case-insensitive: compare and store them in one canonical form.
    const toWalletId = dto.toWalletId.toLowerCase();
    if (toWalletId === walletId.toLowerCase()) {
      throw new BadRequestException([
        'toWalletId must be a different wallet; use a swap to change currency within a wallet',
      ]);
    }
    return this.ledger.move({
      type: 'transfer',
      sourceWalletId: walletId,
      destinationWalletId: toWalletId,
      sourceCurrency: dto.fromCurrency,
      destinationCurrency: dto.toCurrency ?? dto.fromCurrency,
      amount: new Money(dto.amount),
      idempotencyKey,
    });
  }
}
