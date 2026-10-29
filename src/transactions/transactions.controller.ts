import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TransactionDto } from './dto/transaction.dto.js';
import {
  WalletTransactionsPageDto,
  WalletTransactionsQueryDto,
} from './dto/wallet-transactions.dto.js';
import { TransactionsService } from './transactions.service.js';

@ApiTags('transactions')
@Controller()
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get('wallets/:walletId/transactions')
  @ApiOperation({
    summary: "List a wallet's transactions, newest first",
    description:
      'Deposits, swaps and transfers sent and received. Filter by `type` and `currency` (either side of the movement). Paginate with `limit` and the opaque `cursor` from the previous page.',
  })
  @ApiOkResponse({ type: WalletTransactionsPageDto })
  @ApiBadRequestResponse({ description: 'Invalid filter, limit or cursor, or malformed wallet id' })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  list(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query() query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionsPageDto> {
    return this.transactions.listForWallet(walletId, query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a single transaction by id' })
  @ApiOkResponse({ type: TransactionDto })
  @ApiBadRequestResponse({ description: 'id is not a UUID' })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TransactionDto> {
    return this.transactions.findById(id);
  }
}
