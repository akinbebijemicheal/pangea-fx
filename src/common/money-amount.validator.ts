import { ValidateBy, type ValidationOptions } from 'class-validator';
import { AMOUNT_DP } from './money.js';

/** Up to 30 integer digits (NUMERIC(38,8)) and up to 8 decimal places. No sign, no exponent. */
const AMOUNT_PATTERN = new RegExp(`^\\d{1,30}(\\.\\d{1,${AMOUNT_DP}})?$`);

export const MONEY_AMOUNT_MESSAGE = `amount must be a positive decimal string with at most ${AMOUNT_DP} decimal places, e.g. "100.50"`;

/** True for a positive decimal string that fits NUMERIC(38,8) exactly, without rounding. */
export function isMoneyAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value) && /[1-9]/.test(value);
}

/**
 * Money amounts must arrive as strings: a JSON number has already been
 * parsed into a float by the time we see it, and may not be what was sent.
 */
export function IsMoneyAmount(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMoneyAmount',
      validator: {
        validate: (value: unknown) => isMoneyAmount(value),
        defaultMessage: () => MONEY_AMOUNT_MESSAGE,
      },
    },
    options,
  );
}
