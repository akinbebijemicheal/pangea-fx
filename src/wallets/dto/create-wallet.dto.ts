import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export const E164 = /^\+[1-9]\d{7,14}$/;

/** Lowercases and trims; other types pass through so validation can reject them. */
export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** Strips common separators so "+234 803-123 (4567)" and "+2348031234567" are one number. */
export function normalizePhone(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : value;
}

const CONTACT_REQUIRED = 'Provide an email or a phone number';

export class CreateWalletDto {
  @ApiPropertyOptional({
    example: 'ada@example.com',
    description: 'Owner email. Case-insensitive and unique across wallets.',
  })
  // Required when phone is absent, so the "one of" rule reports once, here.
  @ValidateIf((o: CreateWalletDto) => o.phone === undefined || o.email !== undefined)
  @IsDefined({ message: CONTACT_REQUIRED })
  @Transform(({ value }) => normalizeEmail(value))
  // Decorators run bottom-up and the pipe stops at the first failure,
  // so the most basic check sits last.
  @IsEmail()
  @MaxLength(254)
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    example: '+2348031234567',
    description:
      'Owner mobile number in international E.164 format. Spaces, dashes, dots and brackets are ignored. Unique across wallets.',
  })
  // Validated only when present; the "one of" rule lives on email.
  @ValidateIf((o: CreateWalletDto) => o.phone !== undefined)
  @Transform(({ value }) => normalizePhone(value))
  @Matches(E164, { message: 'phone must be in international E.164 format, e.g. +2348031234567' })
  @IsString()
  phone?: string;
}
