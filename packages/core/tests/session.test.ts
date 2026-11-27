import { describe, expect, it } from 'vitest';
import {
  applyTransactionToSession,
  cancelSession,
  createPaymentSession,
  expireSessionIfPastDeadline,
  MemoryStorageAdapter,
  type UnifiedTransaction,
} from '../src/index.js';

function makeTx(overrides: Partial<UnifiedTransaction> = {}): UnifiedTransaction {
  return {
    id: 'cake_FT10001',
    bankCode: 'CAKE',
    bankBin: '546034',
    txId: 'FT10001',
    accountNumber: '0835117727',
    direction: 'in',
    amount: 100000,
    currency: 'VND',
    content: 'MUA123456',
    occurredAt: '2026-11-26T09:00:00.000Z',
    source: 'email_worker',
    rawHash: 'hash123',
    auth: {
      status: 'verified',
      dkimPass: true,
      dkimDomain: 'cake.vn',
      spfPass: true,
      dmarcPass: true,
      arcPass: false,
      envelopeFrom: null,
      headerFrom: 'no-reply@cake.vn',
      reasons: [],
    },
    isTest: false,
    ...overrides,
  };
}

describe('Payment Session State Machine & MemoryStorageAdapter', () => {
  const baseTime = Date.parse('2026-11-26T09:00:00.000Z');

  it('transitions pending -> paid on exact payment and guards duplicate tx', () => {
    const session = createPaymentSession({
      orderCode: 'MUA123456',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      nowMs: baseTime,
    });

    const tx = makeTx();
    const res1 = applyTransactionToSession(session, tx, baseTime + 30_000);
    expect(res1.action).toBe('paid');
    expect(res1.session.status).toBe('paid');
    expect(res1.session.overpaid).toBe(false);
    expect(res1.session.excessAmount).toBe(0);

    const dup = applyTransactionToSession(res1.session, tx, baseTime + 40_000);
    expect(dup.action).toBe('duplicate');
  });

  it('blocks underpayment without auto-approving', () => {
    const session = createPaymentSession({
      orderCode: 'MUA123456',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      nowMs: baseTime,
    });

    const res = applyTransactionToSession(session, makeTx({ amount: 90000 }), baseTime + 10_000);
    expect(res.action).toBe('underpaid');
    expect(res.session.status).toBe('underpaid');
    expect(res.session.missingAmount).toBe(10000);
    expect(res.session.paidAt).toBeUndefined();
  });

  it('marks overpaid=true on overpayment by default, or overpaid_review when exactMatchOnly=true', () => {
    const flexible = createPaymentSession({
      orderCode: 'MUA111',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      nowMs: baseTime,
    });
    const rFlex = applyTransactionToSession(flexible, makeTx({ amount: 115000 }), baseTime + 5_000);
    expect(rFlex.action).toBe('paid');
    expect(rFlex.session.overpaid).toBe(true);
    expect(rFlex.session.excessAmount).toBe(15000);

    const strict = createPaymentSession({
      orderCode: 'MUA222',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      exactMatchOnly: true,
      nowMs: baseTime,
    });
    const rStrict = applyTransactionToSession(strict, makeTx({ amount: 115000 }), baseTime + 5_000);
    expect(rStrict.action).toBe('overpaid_review');
    expect(rStrict.session.status).toBe('overpaid_review');
  });

  it('never auto-approves expired or cancelled sessions (emits late_payment)', () => {
    const session = createPaymentSession({
      orderCode: 'MUA333',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      ttlSeconds: 600,
      nowMs: baseTime,
    });

    const lateExpired = applyTransactionToSession(session, makeTx(), baseTime + 700_000);
    expect(lateExpired.action).toBe('late_payment');
    expect(lateExpired.session.status).toBe('expired');

    const cancelled = cancelSession(session, baseTime + 50_000);
    expect(cancelled.cancelled).toBe(true);
    const lateCancelled = applyTransactionToSession(cancelled.session, makeTx(), baseTime + 60_000);
    expect(lateCancelled.action).toBe('late_payment');
    expect(lateCancelled.session.status).toBe('cancelled');

    const watchdog = expireSessionIfPastDeadline(session, baseTime + 650_000);
    expect(watchdog.expired).toBe(true);
    expect(watchdog.session.status).toBe('expired');
  });

  it('accumulates split underpayments until reaching expectedAmount and deduplicates identical tx', () => {
    const session = createPaymentSession({
      orderCode: 'MUA555',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      nowMs: baseTime,
    });

    const first = applyTransactionToSession(
      session,
      makeTx({ id: 'cake_FT_PART1', txId: 'FT_PART1', amount: 40000 }),
      baseTime + 10_000
    );
    expect(first.action).toBe('underpaid');
    expect(first.session.receivedAmount).toBe(40000);
    expect(first.session.missingAmount).toBe(60000);

    // Re-applying same tx does not double count
    const dupPart = applyTransactionToSession(
      first.session,
      makeTx({ id: 'cake_FT_PART1', txId: 'FT_PART1', amount: 40000 }),
      baseTime + 15_000
    );
    expect(dupPart.action).toBe('duplicate');
    expect(dupPart.session.receivedAmount).toBe(40000);

    // Second transfer completes 40,000 + 60,000 = 100,000 -> paid
    const second = applyTransactionToSession(
      first.session,
      makeTx({ id: 'cake_FT_PART2', txId: 'FT_PART2', amount: 60000 }),
      baseTime + 20_000
    );
    expect(second.action).toBe('paid');
    expect(second.session.status).toBe('paid');
    expect(second.session.receivedAmount).toBe(100000);
    expect(second.session.missingAmount).toBe(0);
    expect(second.session.overpaid).toBe(false);
    expect(second.session.paidAt).toBeDefined();
  });

  it('keeps a paid session paid even when a second tx arrives after expiresAt', () => {
    const session = createPaymentSession({
      orderCode: 'MUA666',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      ttlSeconds: 600,
      nowMs: baseTime,
    });

    const paid = applyTransactionToSession(
      session,
      makeTx({ id: 'cake_FT_PAID1', txId: 'FT_PAID1', amount: 100000 }),
      baseTime + 30_000
    );
    expect(paid.action).toBe('paid');
    expect(paid.session.status).toBe('paid');

    // Second distinct transaction arrives AFTER expiresAt: MUST stay paid (never downgrade to expired)
    const afterExpiry = applyTransactionToSession(
      paid.session,
      makeTx({ id: 'cake_FT_PAID2', txId: 'FT_PAID2', amount: 100000 }),
      baseTime + 900_000
    );
    expect(afterExpiry.action).toBe('duplicate');
    expect(afterExpiry.session.status).toBe('paid');
    expect(afterExpiry.session.receivedAmount).toBe(100000);
  });

  it('requires exact receiver account match in applyTransactionToSession', () => {
    const session = createPaymentSession({
      orderCode: 'MUA777',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 100000,
      nowMs: baseTime,
    });

    const res = applyTransactionToSession(
      session,
      makeTx({ accountNumber: '108351177279' }),
      baseTime + 10_000
    );
    expect(res.action).toBe('ignored');
  });

  it('persists sessions and idempotency keys in MemoryStorageAdapter', async () => {
    const store = new MemoryStorageAdapter();
    const session = createPaymentSession({
      orderCode: 'MUA444',
      bankCode: 'CAKE',
      bankBin: '546034',
      accountNumber: '0835117727',
      accountName: 'TRAN MINH TAN',
      expectedAmount: 50000,
    });

    await store.saveSession(session);
    expect((await store.getSessionByOrderCode('mua444'))?.id).toBe(session.id);
    expect((await store.getSessionByShortId(session.shortId))?.id).toBe(session.id);

    await store.markProcessedTx('cake_FT10001');
    expect(await store.hasProcessedTx('cake_FT10001')).toBe(true);
  });
});
