import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateWalletDto, normalizeEmail, normalizePhone } from './create-wallet.dto.js';

function validate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateWalletDto, body);
  const messages = validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
  return { dto, messages };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('passes non-strings through for validation to reject', () => {
    expect(normalizeEmail(42)).toBe(42);
  });
});

describe('normalizePhone', () => {
  it('strips spaces, dashes, dots and brackets', () => {
    expect(normalizePhone('+234 (803) 123-45.67')).toBe('+2348031234567');
  });
});

describe('CreateWalletDto', () => {
  it('accepts an email only', () => {
    const { dto, messages } = validate({ email: ' Ada@Example.com' });
    expect(messages).toEqual([]);
    expect(dto.email).toBe('ada@example.com');
  });

  it('accepts a phone only, normalised to E.164', () => {
    const { dto, messages } = validate({ phone: '+234 803 123 4567' });
    expect(messages).toEqual([]);
    expect(dto.phone).toBe('+2348031234567');
  });

  it('accepts both', () => {
    expect(validate({ email: 'a@b.co', phone: '+233201234567' }).messages).toEqual([]);
  });

  it('requires at least one of email or phone', () => {
    const { messages } = validate({});
    expect(messages).toContain('Provide an email or a phone number');
  });

  it('rejects an invalid email even when phone is valid', () => {
    expect(validate({ email: 'nope', phone: '+233201234567' }).messages).toContain(
      'email must be an email',
    );
  });

  it.each(['08031234567', '+0123456789', '+123', '+2348031234567890123', 'abc'])(
    'rejects non-E.164 phone %s',
    (phone) => {
      expect(validate({ phone }).messages.join()).toMatch(/E\.164/);
    },
  );

  it('rejects a non-string email', () => {
    expect(validate({ email: 42 }).messages).toContain('email must be a string');
  });
});
