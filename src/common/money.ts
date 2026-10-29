import { Decimal } from 'decimal.js';

/**
 * Decimal constructor for all money and rate maths. 50 significant digits is
 * far beyond NUMERIC(38,8) amounts and NUMERIC(38,18) rates, so intermediate
 * results never lose precision before the explicit rounding steps below.
 * The exponent limits stop toString() from ever producing "1e-7" style output.
 */
export const Money = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Money = Decimal;

/** Amounts are stored and returned with exactly this many decimal places. */
export const AMOUNT_DP = 8;

/** Applied FX rates are rounded to this many significant digits. */
export const RATE_SIGNIFICANT_DIGITS = 15;

/** Fixed 8 dp string, rounded down so formatting can never round value up. */
export function toAmountString(value: Decimal.Value): string {
  return new Money(value).toFixed(AMOUNT_DP, Decimal.ROUND_DOWN);
}

/**
 * Rounds a rate to the precision we apply and record. The rounded rate is the
 * one used for conversion, so a stored transaction can always be re-derived
 * exactly from its amount and rate.
 */
export function roundRate(rate: Decimal): Decimal {
  return rate.toSignificantDigits(RATE_SIGNIFICANT_DIGITS, Decimal.ROUND_HALF_EVEN);
}

export function toRateString(rate: Decimal): string {
  return roundRate(rate).toFixed();
}

/**
 * Converts an amount at a rate, rounding the result DOWN to 8 dp: the platform
 * never credits more than the exact conversion, so rounding cannot create value.
 */
export function convert(amount: Decimal, rate: Decimal): Decimal {
  return amount.times(rate).toDecimalPlaces(AMOUNT_DP, Decimal.ROUND_DOWN);
}
