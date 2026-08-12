/**
 * Activity & Records view models (Phase 4)
 * -----------------------------------------------------------------------------
 * Transactions + Documents presentation shapes. Services map the CRM entities
 * (NWTransaction, nw_documents) into these; the UI never sees raw rows.
 */
import type { ProductType } from '../../crm/types';

export interface TransactionRow {
  id: string;
  productType: ProductType;
  productLabel: string;
  /** Vivid theme-constant hex for the product. */
  productColor: string;
  name: string;
  txnType: 'buy' | 'sell';
  amount: number;
  units?: number;
  price?: number;
  date: string;
}

export type TxnTypeFilter = 'all' | 'buy' | 'sell';

export interface TxnFilter {
  query: string;
  product: ProductType | 'all';
  type: TxnTypeFilter;
}

export const DEFAULT_TXN_FILTER: TxnFilter = { query: '', product: 'all', type: 'all' };

/** Running totals for the transactions summary bar. */
export interface TxnSummary {
  invested: number;
  redeemed: number;
  count: number;
}

/** A client-facing document row (from nw_documents). */
export interface ClientDocument {
  id: string;
  fileName: string;
  docType: string;
  docTypeLabel: string;
  /** Storage path in the `crm-documents` bucket — used to mint a signed URL. */
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}
