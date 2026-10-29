import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { E164, normalizeEmail, normalizePhone } from './create-wallet.dto.js';

const ONE_OF = 'Provide exactly one of email or phone';

/** Query for GET /wallets/lookup. Normalised the same way as wallet creation. */
export class LookupWalletQueryDto {
  @ApiPropertyOptional({ example: 'ada@example.com' })
  // Required when phone is absent, so the "one of" rule reports once, here.
  @ValidateIf((o: LookupWalletQueryDto) => o.phone === undefined || o.email !== undefined)
  @IsDefined({ message: ONE_OF })
  @Transform(({ value }) => normalizeEmail(value))
  // Decorators run bottom-up and the pipe stops at the first failure.
  @IsEmail()
  @MaxLength(254)
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '+2348031234567' })
  @ValidateIf((o: LookupWalletQueryDto) => o.phone !== undefined)
  @Transform(({ value }) => normalizePhone(value))
  @Matches(E164, { message: 'phone must be in international E.164 format, e.g. +2348031234567' })
  @IsString()
  phone?: string;
}

export const LOOKUP_ONE_OF_MESSAGE = ONE_OF;
