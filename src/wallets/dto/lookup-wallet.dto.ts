import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { E164, normalizeEmail, normalizePhone } from './create-wallet.dto.js';

const ONE_OF = 'Provide exactly one of email or phone';

/**
 * In a query string an unencoded '+' decodes to a space, so ?phone=+233...
 * arrives as ' 233...'. A leading space before a digit can only be that
 * decoded '+', so restore it before the usual normalisation.
 */
export function normalizeQueryPhone(value: unknown): unknown {
  if (typeof value === 'string' && /^ \d/.test(value)) return normalizePhone(`+${value.slice(1)}`);
  return normalizePhone(value);
}

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

  @ApiPropertyOptional({
    example: '+2348031234567',
    description: 'International format. An unencoded + (decoded as a space) is accepted.',
  })
  @ValidateIf((o: LookupWalletQueryDto) => o.phone !== undefined)
  @Transform(({ value }) => normalizeQueryPhone(value))
  @Matches(E164, { message: 'phone must be in international E.164 format, e.g. +2348031234567' })
  @IsString()
  phone?: string;
}

export const LOOKUP_ONE_OF_MESSAGE = ONE_OF;
