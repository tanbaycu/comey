import { generateShortId, randomHex } from '../security/crypto.js';
import type {
  BankCode,
  PaymentSession,
  UnifiedTransaction,
  WebhookEventType,
} from '../types.js';

export interface CreatePaymentSessionParams {
  orderCode: string;
  bankCode: BankCode;
  bankBin: string;
  accountNumber: string;
  accountName: string;
  expectedAmount: number;
  exactMatchOnly?: boolean;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  nowMs?: number;
}

export function createPaymentSession(params: CreatePaymentSessionParams): PaymentSession {
  const expectedAmount = Math.floor(params.expectedAmount);
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error('expectedAmount must be a positive integer');
  }
  const orderCode = String(params.orderCode || '').trim();
  if (!orderCode) {
    throw new Error('orderCode is required');
  }

  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(60, params.ttlSeconds ?? 600) * 1000;
  const nowIso = new Date(nowMs).toISOString();

  return {
    id: `sess_${randomHex(12)}`,
    shortId: generateShortId(12),
    orderCode,
    bankCode: params.bankCode,
    bankBin: params.bankBin,
    accountNumber: params.accountNumber,
    accountName: params.accountName,
    expectedAmount,
    receivedAmount: 0,
    exactMatchOnly: Boolean(params.exactMatchOnly),
    status: 'pending',
    overpaid: false,
    excessAmount: 0,
    missingAmount: expectedAmount,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: params.metadata,
  };
}

export type SessionApplyOutcome =
  | {
      action: 'ignored';
      reason: string;
      session: PaymentSession;
    }
  | {
      action: 'duplicate';
      session: PaymentSession;
    }
  | {
      action: 'paid';
      eventType: Extract<WebhookEventType, 'session.paid'>;
      session: PaymentSession;
      transaction: UnifiedTransaction;
    }
  | {
      action: 'underpaid';
      eventType: Extract<WebhookEventType, 'session.underpaid'>;
      session: PaymentSession;
      transaction: UnifiedTransaction;
    }
  | {
      action: 'overpaid_review';
      eventType: Extract<WebhookEventType, 'session.overpaid_review'>;
      session: PaymentSession;
      transaction: UnifiedTransaction;
    }
  | {
      action: 'late_payment';
      eventType: Extract<WebhookEventType, 'session.late_payment'>;
      session: PaymentSession;
      transaction: UnifiedTransaction;
    };

export function applyTransactionToSession(
  session: PaymentSession,
  tx: UnifiedTransaction,
  nowMs: number = Date.now()
): SessionApplyOutcome {
  if (tx.direction !== 'in') {
    return { action: 'ignored', reason: 'Outgoing transaction', session };
  }

  const cleanSessionAcc = session.accountNumber.replace(/\D/g, '');
  const cleanTxAcc = tx.accountNumber.replace(/\D/g, '');
  if (cleanSessionAcc && cleanTxAcc && cleanTxAcc !== cleanSessionAcc) {
    return { action: 'ignored', reason: 'Account number mismatch', session };
  }

  // A paid session is terminal and must never downgrade to expired/late_payment
  // even if another transaction arrives after expiresAt.
  if (session.status === 'paid') {
    return { action: 'duplicate', session };
  }

  // Guard against re-applying the exact same transaction twice to an underpaid/review session.
  if (session.matchedTxId && session.matchedTxId === tx.id) {
    return { action: 'duplicate', session };
  }

  const nowIso = new Date(nowMs).toISOString();
  const expiresMs = Date.parse(session.expiresAt);
  const isPastDeadline = Number.isFinite(expiresMs) && nowMs > expiresMs;
  const accumulatedReceived = (session.receivedAmount || 0) + tx.amount;

  if (session.status === 'cancelled' || session.status === 'expired' || isPastDeadline) {
    const updated: PaymentSession = {
      ...session,
      status: session.status === 'cancelled' ? 'cancelled' : 'expired',
      receivedAmount: accumulatedReceived,
      matchedTxId: session.matchedTxId ?? tx.id,
      updatedAt: nowIso,
    };
    return {
      action: 'late_payment',
      eventType: 'session.late_payment',
      session: updated,
      transaction: tx,
    };
  }

  if (accumulatedReceived < session.expectedAmount) {
    const updated: PaymentSession = {
      ...session,
      status: 'underpaid',
      receivedAmount: accumulatedReceived,
      missingAmount: session.expectedAmount - accumulatedReceived,
      overpaid: false,
      excessAmount: 0,
      matchedTxId: tx.id,
      updatedAt: nowIso,
    };
    return {
      action: 'underpaid',
      eventType: 'session.underpaid',
      session: updated,
      transaction: tx,
    };
  }

  const excess = Math.max(0, accumulatedReceived - session.expectedAmount);
  const isOverpaid = excess > 0;

  if (isOverpaid && session.exactMatchOnly) {
    const updated: PaymentSession = {
      ...session,
      status: 'overpaid_review',
      receivedAmount: accumulatedReceived,
      overpaid: true,
      excessAmount: excess,
      missingAmount: 0,
      matchedTxId: tx.id,
      updatedAt: nowIso,
    };
    return {
      action: 'overpaid_review',
      eventType: 'session.overpaid_review',
      session: updated,
      transaction: tx,
    };
  }

  const updated: PaymentSession = {
    ...session,
    status: 'paid',
    receivedAmount: accumulatedReceived,
    overpaid: isOverpaid,
    excessAmount: excess,
    missingAmount: 0,
    matchedTxId: tx.id,
    paidAt: nowIso,
    updatedAt: nowIso,
  };
  return {
    action: 'paid',
    eventType: 'session.paid',
    session: updated,
    transaction: tx,
  };
}

export function expireSessionIfPastDeadline(
  session: PaymentSession,
  nowMs: number = Date.now()
): { expired: boolean; session: PaymentSession } {
  if (session.status !== 'pending' && session.status !== 'underpaid') {
    return { expired: false, session };
  }
  const expiresMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresMs) || nowMs <= expiresMs) {
    return { expired: false, session };
  }
  return {
    expired: true,
    session: {
      ...session,
      status: 'expired',
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
}

export function cancelSession(
  session: PaymentSession,
  nowMs: number = Date.now()
): { cancelled: boolean; session: PaymentSession } {
  if (session.status === 'paid' || session.status === 'cancelled') {
    return { cancelled: false, session };
  }
  const nowIso = new Date(nowMs).toISOString();
  return {
    cancelled: true,
    session: {
      ...session,
      status: 'cancelled',
      cancelledAt: nowIso,
      updatedAt: nowIso,
    },
  };
}
