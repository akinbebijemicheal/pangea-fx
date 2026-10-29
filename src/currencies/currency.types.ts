import type { Currency } from '../common/currency.js';

export interface CurrencyRow {
  code: Currency;
  name: string;
  fiat_code: string;
  sort_order: number;
  created_at: Date;
}
