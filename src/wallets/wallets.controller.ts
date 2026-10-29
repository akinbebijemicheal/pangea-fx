import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { LookupWalletQueryDto } from './dto/lookup-wallet.dto.js';
import { WalletBalancesDto, WalletDto } from './dto/wallet-response.dto.js';
import { WalletsService } from './wallets.service.js';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a wallet for an email and/or phone number' })
  @ApiCreatedResponse({ type: WalletDto })
  @ApiBadRequestResponse({ description: 'Neither email nor phone given, or a value is invalid' })
  @ApiConflictResponse({ description: 'The email or phone already has a wallet' })
  create(@Body() dto: CreateWalletDto): Promise<WalletDto> {
    return this.wallets.create(dto);
  }

  // Declared before :id so "lookup" is not parsed as a wallet id.
  @Get('lookup')
  @ApiOperation({ summary: 'Find a wallet by email or phone number' })
  @ApiOkResponse({ type: WalletDto })
  @ApiBadRequestResponse({
    description: 'Not exactly one of email or phone, or a value is invalid',
  })
  @ApiNotFoundResponse({ description: 'No wallet for this contact' })
  lookup(@Query() query: LookupWalletQueryDto): Promise<WalletDto> {
    return this.wallets.lookup(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallet with its balances' })
  @ApiOkResponse({ type: WalletDto })
  @ApiBadRequestResponse({ description: 'id is not a UUID' })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WalletDto> {
    return this.wallets.findById(id);
  }

  @Get(':id/balances')
  @ApiOperation({ summary: 'Get all balances for a wallet' })
  @ApiOkResponse({ type: WalletBalancesDto })
  @ApiBadRequestResponse({ description: 'id is not a UUID' })
  @ApiNotFoundResponse({ description: 'Wallet not found' })
  balances(@Param('id', ParseUUIDPipe) id: string): Promise<WalletBalancesDto> {
    return this.wallets.getBalances(id);
  }
}
