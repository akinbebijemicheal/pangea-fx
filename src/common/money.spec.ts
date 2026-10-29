import { describe, expect, it } from 'vitest';
import { convert, Money, roundRate, toAmountString, toRateString } from './money.js';

describe('Money', () => {
  it('does exact decimal arithmetic where floats fail', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Money('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('never formats with exponent notation', () => {
    expect(new Money('0.00000001').toString()).toBe('0.00000001');
    expect(new Money('1e30').toString()).toBe('1000000000000000000000000000000');
  });
});

describe('toAmountString', () => {
  it('pads to 8 decimal places', () => {
    expect(toAmountString('12.5')).toBe('12.50000000');
    expect(toAmountString(0)).toBe('0.00000000');
  });

  it('rounds down, never up', () => {
    expect(toAmountString('0.999999999')).toBe('0.99999999');
  });

  it('keeps 30 integer digits intact', () => {
    expect(toAmountString('123456789012345678901234567890.12345678')).toBe(
      '123456789012345678901234567890.12345678',
    );
  });
});

describe('roundRate / toRateString', () => {
  it('rounds to 15 significant digits, half-even', () => {
    expect(toRateString(new Money(1).div(3))).toBe('0.333333333333333');
    expect(toRateString(new Money(2).div(3))).toBe('0.666666666666667');
  });

  it('keeps significance for very small rates', () => {
    expect(toRateString(new Money(1).div(1_500_000))).toBe('0.000000666666666666667');
  });

  it('leaves short rates unchanged', () => {
    expect(roundRate(new Money('0.86')).toString()).toBe('0.86');
  });
});

describe('convert', () => {
  it('multiplies and rounds the result down to 8 dp', () => {
    expect(convert(new Money('100'), new Money('0.333333333333333')).toFixed()).toBe('33.33333333');
  });

  it('rounds down even when the next digit is 9', () => {
    expect(convert(new Money('1'), new Money('0.123456789999')).toFixed()).toBe('0.12345678');
  });

  it('is exact for terminating results', () => {
    expect(convert(new Money('1000'), new Money('1550')).toFixed()).toBe('1550000');
  });
});
