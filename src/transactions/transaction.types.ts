import type { Currency } from '../common/currency.js';
import type { RateSource } from '../fx/fx.types.js';

export const TRANSACTION_TYPES = ['deposit', 'swap', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface TransactionRow {
  id: string;
  type: TransactionType;
  source_wallet_id: string | null;
  destination_wallet_id: string;
  source_currency: Currency;
  source_amount: string;
  destination_currency: Currency;
  destination_amount: string;
  rate: string;
  rate_source: RateSource | null;
  rate_provider: string | null;
  rate_refreshed_at: Date | null;
  idempotency_key: string;
  created_at: Date;
}

export type NewTransaction = Omit<TransactionRow, 'id' | 'created_at'>;
