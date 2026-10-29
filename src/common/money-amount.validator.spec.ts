import { describe, expect, it } from 'vitest';
import { isMoneyAmount } from './money-amount.validator.js';

describe('isMoneyAmount', () => {
  it.each([
    '1',
    '0.00000001',
    '100.5',
    '1500000.12345678',
    '123456789012345678901234567890.12345678',
  ])('accepts %s', (value) => {
    expect(isMoneyAmount(value)).toBe(true);
  });

  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.00000000'],
    ['negative', '-1'],
    ['plus sign', '+1'],
    ['9 decimal places', '1.123456789'],
    ['31 integer digits', '1234567890123456789012345678901'],
    ['exponent', '1e5'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['comma', '1,000'],
    ['whitespace', ' 1'],
    ['empty', ''],
    ['JSON number', 100],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isMoneyAmount(value)).toBe(false);
  });
});
