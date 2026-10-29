import type { Currency } from '../common/currency.js';

export interface WalletRow {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: Date;
}

export interface BalanceRow {
  wallet_id: string;
  currency: Currency;
  /** NUMERIC(38,8); pg returns it as a string, which we keep to avoid float loss. */
  amount: string;
  updated_at: Date;
}
