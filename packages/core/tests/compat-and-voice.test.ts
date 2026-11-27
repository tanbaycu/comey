import { describe, expect, it } from 'vitest';
import {
  formatPayOSWebhookPayload,
  formatSePayWebhookPayload,
  formatSoundboxSpeech,
  formatVnDateTimeString,
  signPayOSData,
  verifyPayOSWebhookSignature,
  vndToVietnameseWords,
} from '../src/index.js';
import type { UnifiedTransaction } from '../src/types.js';

const SAMPLE_TX: UnifiedTransaction = {
  id: 'tx_sample_01',
  bankCode: 'cake',
  bankBin: '546034',
  txId: 'FT2611260001',
  accountNumber: '0909123456',
  direction: 'in',
  amount: 80000,
  currency: 'VND',
  content: 'CMTEST01 thanh toan don hang 8899',
  occurredAt: '2026-11-26T05:30:15.000Z', // 12:30:15 UTC+7
  senderName: 'NGUYEN VAN A',
  senderBank: 'MBBank',
  source: 'email_worker',
  rawHash: 'hash_sample_01',
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
};

describe('vndToVietnameseWords & formatSoundboxSpeech', () => {
  it('converts common VND amounts accurately into natural Vietnamese words', () => {
    expect(vndToVietnameseWords(0)).toBe('không');
    expect(vndToVietnameseWords(5)).toBe('năm');
    expect(vndToVietnameseWords(15)).toBe('mười lăm');
    expect(vndToVietnameseWords(21)).toBe('hai mươi mốt');
    expect(vndToVietnameseWords(105)).toBe('một trăm linh năm');
    expect(vndToVietnameseWords(80000)).toBe('tám mươi nghìn');
    expect(vndToVietnameseWords(150000)).toBe('một trăm năm mươi nghìn');
    expect(vndToVietnameseWords(1050000)).toBe('một triệu không trăm năm mươi nghìn');
    expect(vndToVietnameseWords(1005000)).toBe('một triệu không trăm linh năm nghìn');
    expect(vndToVietnameseWords(1000000000)).toBe('một tỷ');
    expect(vndToVietnameseWords(1_000_000_000_000)).toBe('một nghìn tỷ');
    expect(vndToVietnameseWords(1_005_000_000_000)).toBe('một nghìn không trăm linh năm tỷ');
    expect(vndToVietnameseWords(1_005_000_000_001)).toBe(
      'một nghìn không trăm linh năm tỷ không trăm linh một'
    );
    expect(vndToVietnameseWords(1_000_000_000_000_000)).toBe('một triệu tỷ');
  });

  it('builds soundbox speech string with default and custom templates', () => {
    expect(formatSoundboxSpeech({ amount: 80000, currency: 'VND' })).toBe(
      'Đã nhận tám mươi nghìn đồng'
    );

    expect(
      formatSoundboxSpeech({
        amount: 250000,
        currency: 'VND',
        senderName: 'Nguyen Van A',
        template: 'Thanh toán thành công {amountWords} ({amountFormatted}) {currency} từ {senderName}',
      })
    ).toBe('Thanh toán thành công hai trăm năm mươi nghìn (250.000) đồng từ Nguyen Van A');
  });
});

describe('SePay and PayOS webhook compatibility formatters', () => {
  it('formats UTC+7 datetime string identically across timezones', () => {
    expect(formatVnDateTimeString('2026-11-26T05:30:15.000Z')).toBe('2026-11-26 12:30:15');
  });

  it('produces SePay-compatible webhook payload schema', () => {
    const payload = formatSePayWebhookPayload(SAMPLE_TX);
    expect(payload.id).toBeGreaterThan(0);
    expect(payload.gateway).toBe('CAKE');
    expect(payload.transactionDate).toBe('2026-11-26 12:30:15');
    expect(payload.accountNumber).toBe('0909123456');
    expect(payload.code).toBe('CMTEST01');
    expect(payload.content).toBe(SAMPLE_TX.content);
    expect(payload.transferType).toBe('in');
    expect(payload.transferAmount).toBe(80000);
    expect(payload.accumulated).toBe(0);
    expect(payload.subAccount).toBeNull();
    expect(payload.referenceCode).toBe('FT2611260001');
    expect(payload.description).toBe(SAMPLE_TX.content);
  });

  it('produces and verifies PayOS-compatible canonical HMAC-SHA256 webhook signature', async () => {
    const checksumKey = 'test_payos_checksum_key_123456';
    const payload = await formatPayOSWebhookPayload(SAMPLE_TX, checksumKey);

    expect(payload.code).toBe('00');
    expect(payload.success).toBe(true);
    expect(payload.data.orderCode).toBe(8899);
    expect(payload.data.amount).toBe(80000);
    expect(payload.data.transactionDateTime).toBe('2026-11-26 12:30:15');
    expect(payload.data.reference).toBe('FT2611260001');
    expect(payload.signature).toMatch(/^[a-f0-9]{64}$/);

    // Verify with official PayOS canonical sort rule
    expect(await verifyPayOSWebhookSignature(payload, checksumKey)).toBe(true);
    expect(await verifyPayOSWebhookSignature(payload, 'wrong_key')).toBe(false);

    // Tampered amount invalidates signature
    const tampered = {
      ...payload,
      data: { ...payload.data, amount: 999999 },
    };
    expect(await verifyPayOSWebhookSignature(tampered, checksumKey)).toBe(false);

    // Canonical sorting is key-order independent
    const reversedData = {
      transactionDateTime: payload.data.transactionDateTime,
      amount: payload.data.amount,
      orderCode: payload.data.orderCode,
    };
    const forwardData = {
      orderCode: payload.data.orderCode,
      amount: payload.data.amount,
      transactionDateTime: payload.data.transactionDateTime,
    };
    expect(await signPayOSData(reversedData, checksumKey)).toBe(
      await signPayOSData(forwardData, checksumKey)
    );

    // Invalid inputs return false without throwing WebCrypto DataError
    expect(await verifyPayOSWebhookSignature(payload, '')).toBe(false);
    expect(
      await verifyPayOSWebhookSignature(
        { data: null as unknown as Record<string, unknown>, signature: payload.signature },
        checksumKey
      )
    ).toBe(false);
    expect(
      await verifyPayOSWebhookSignature(
        { data: [] as unknown as Record<string, unknown>, signature: payload.signature },
        checksumKey
      )
    ).toBe(false);

    // Extracts numeric orderCode reliably from alphanumeric codes like SHOP100200 / INV-123456
    const alphaPayload = await formatPayOSWebhookPayload(
      { ...SAMPLE_TX, content: 'Thanh toan SHOP100200 ngay 26/11/2026' },
      checksumKey
    );
    expect(alphaPayload.data.orderCode).toBe(100200);

    const hyphenPayload = await formatPayOSWebhookPayload(
      { ...SAMPLE_TX, content: 'Chuyen khoan INV-123456' },
      checksumKey
    );
    expect(hyphenPayload.data.orderCode).toBe(123456);
  });
});
