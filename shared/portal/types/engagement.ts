/**
 * Engagement view models (Phase 4C)
 * -----------------------------------------------------------------------------
 * SIP mandates + notifications. Both are MOCK-flagged until a SIP mandate table
 * and a client notifications feed exist — the UI renders an honest indicator.
 */

export interface SipMandate {
  id: string;
  fundName: string;
  amc?: string;
  amount: number;
  frequency: 'Monthly' | 'Quarterly' | 'Weekly';
  nextDate: string;
  startedOn: string;
  installmentsDone: number;
  /** Undefined = perpetual (until cancelled). */
  totalInstallments?: number;
  investedSoFar: number;
  status: 'active' | 'paused';
  isMock: boolean;
}

export type NotificationCategory =
  | 'transaction'
  | 'sip'
  | 'nav'
  | 'kyc'
  | 'document'
  | 'general';

export interface PortalNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  date: string;
  read: boolean;
  isMock: boolean;
}
