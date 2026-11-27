import { describe, expect, it } from 'vitest';
import {
  formatDiscordWebhookPayload,
  formatGoogleSheetsRowPayload,
  formatTelegramMessagePayload,
  processIncomingEmail,
} from '../src/index.js';
import type { UnifiedTransaction } from '../src/types.js';

const BASE_TX: UnifiedTransaction = {
  id: 'mb_FT123456',
  bankCode: 'MB',
  bankBin: '970422',
  txId: 'FT123456',
  accountNumber: '0909111222',
  direction: 'in',
  amount: 120000,
  currency: 'VND',
  content: 'DH8899 <script>alert(1)</script>',
  occurredAt: '2026-11-26T05:30:00.000Z',
  senderName: 'NGUYEN <B> VAN',
  senderBank: 'VCB',
  source: 'email_worker',
  rawHash: 'hash_01',
  auth: {
    status: 'verified',
    dkimPass: true,
    dkimDomain: 'mbbank.com.vn',
    spfPass: true,
    dmarcPass: true,
    arcPass: false,
    envelopeFrom: null,
    headerFrom: 'no-reply@mbbank.com.vn',
    reasons: [],
  },
  isTest: false,
};

describe('Multi-Bank Email Parsers (MB, VCB, Techcombank, Timo, ACB)', () => {
  it('parses incoming MB Bank email accurately', async () => {
    const res = await processIncomingEmail(
      {
        source: 'email_worker',
        from: 'MB Bank <no-reply@mbbank.com.vn>',
        subject: 'Thông báo biến động số dư',
        authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=mbbank.com.vn',
        textBody: [
          'Tài khoản: 0909111222',
          'Số tiền: +150,000 VND',
          'Thời gian giao dịch: 26/11/2026 14:20:00',
          'Mã giao dịch: FT26330001',
          'Nội dung chuyển tiền: SHOP9911 Thanh toan don hang',
          'Tên người chuyển: LE THI C',
        ].join('\n'),
      },
      { expectedAccountNo: '0909111222' }
    );
    expect(res.outcome).toBe('parsed');
    if (res.outcome === 'parsed') {
      expect(res.transaction.bankCode).toBe('MB');
      expect(res.transaction.amount).toBe(150000);
      expect(res.transaction.txId).toBe('FT26330001');
      expect(res.transaction.content).toContain('SHOP9911');
      expect(res.transaction.senderName).toBe('LE THI C');
    }
  });

  it('parses Vietcombank email with masked account and decimals (.00)', async () => {
    const res = await processIncomingEmail(
      {
        source: 'email_worker',
        from: 'VCB Digibank <no-reply@vietcombank.com.vn>',
        subject: 'Bien dong so du tai khoan',
        authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=vietcombank.com.vn',
        htmlBody: `<table>
          <tr><td>Tài khoản ghi có:</td><td>0909***222</td></tr>
          <tr><td>Số tiền ghi có:</td><td>+250,000.00 VND (Phí: 0 VND)</td></tr>
          <tr><td>Số lệnh giao dịch:</td><td>VCB998877</td></tr>
          <tr><td>Nội dung chuyển tiền:</td><td>ORD4455 mua tra sua</td></tr>
          <tr><td>Thời gian giao dịch:</td><td>26/11/2026 15:05:10</td></tr>
        </table>`,
      },
      { expectedAccountNo: '0909111222' }
    );
    expect(res.outcome).toBe('parsed');
    if (res.outcome === 'parsed') {
      expect(res.transaction.bankCode).toBe('VCB');
      expect(res.transaction.amount).toBe(250000);
      expect(res.transaction.accountNumber).toBe('0909111222');
      expect(res.transaction.txId).toBe('VCB998877');
    }
  });

  it('parses Techcombank, Timo, and ACB incoming emails and ignores outgoing debits', async () => {
    const tcb = await processIncomingEmail({
      source: 'email_worker',
      from: 'no-reply@techcombank.com.vn',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=techcombank.com.vn',
      textBody: [
        'Tài khoản: 190333444555',
        'Số tiền giao dịch: +80.000 đ',
        'Số bút toán: TCB261126A',
        'Diễn giải: PAY80K cafe',
        'Thời gian giao dịch: 26/11/2026 09:00:00',
      ].join('\n'),
    });
    expect(tcb.outcome).toBe('parsed');
    if (tcb.outcome === 'parsed') {
      expect(tcb.transaction.bankCode).toBe('TECHCOMBANK');
      expect(tcb.transaction.amount).toBe(80000);
    }

    const timo = await processIncomingEmail({
      source: 'email_worker',
      from: 'support@timo.vn',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=timo.vn',
      textBody: [
        'Spend Account: 902111222333',
        'Số tiền: +95,000 VND',
        'Reference: TIMO556677',
        'Mô tả: TIMOPAY don 1',
      ].join('\n'),
    });
    expect(timo.outcome).toBe('parsed');
    if (timo.outcome === 'parsed') {
      expect(timo.transaction.bankCode).toBe('TIMO');
      expect(timo.transaction.amount).toBe(95000);
    }

    const acb = await processIncomingEmail({
      source: 'email_worker',
      from: 'alert@acb.com.vn',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=acb.com.vn',
      textBody: [
        'Tài khoản: 204888999',
        'Số tiền: Ghi có 45.000 VND',
        'Nội dung: ACB45K banh mi',
      ].join('\n'),
    });
    expect(acb.outcome).toBe('parsed');
    if (acb.outcome === 'parsed') {
      expect(acb.transaction.bankCode).toBe('ACB');
      expect(acb.transaction.amount).toBe(45000);
      expect(acb.transaction.txId.startsWith('FTACB')).toBe(true);
    }

    // Outgoing transfer ignored cleanly
    const outgoing = await processIncomingEmail({
      source: 'email_worker',
      from: 'no-reply@mbbank.com.vn',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=mbbank.com.vn',
      textBody: [
        'Tài khoản: 0909111222',
        'Số tiền: -50,000 VND',
        'Mã giao dịch: FT99999',
        'Nội dung: Chuyen tien ra',
      ].join('\n'),
    });
    expect(outgoing.outcome).toBe('ignored');
  });
});

describe('No-Server Notification Payload Formatters (Telegram, Discord, Google Sheets)', () => {
  it('formats Telegram HTML safely without XSS tags and marks TEST transactions', () => {
    const tg = formatTelegramMessagePayload(BASE_TX, '-1001234567890');
    expect(tg.chat_id).toBe('-1001234567890');
    expect(tg.parse_mode).toBe('HTML');
    expect(tg.text).toContain('+120.000 đ');
    expect(tg.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(tg.text).toContain('NGUYEN &lt;B&gt; VAN');
    expect(tg.text).not.toContain('<script>');

    const tgTest = formatTelegramMessagePayload({ ...BASE_TX, isTest: true }, '12345');
    expect(tgTest.text).toContain('[TEST]');
  });

  it('formats Discord embed and Google Sheets row payloads cleanly', () => {
    const discord = formatDiscordWebhookPayload(BASE_TX);
    expect(discord.username).toBe('Comey Pay');
    expect(discord.embeds[0]?.color).toBe(0x0d6e4f);
    expect(discord.embeds[0]?.title).toContain('+120.000 đ');
    expect(discord.embeds[0]?.fields.some((f) => f.value.includes('FT123456'))).toBe(true);

    const sheet = formatGoogleSheetsRowPayload(BASE_TX, 'sheet_sec_1');
    expect(sheet.amount).toBe(120000);
    expect(sheet.bankCode).toBe('MB');
    expect(sheet.secret).toBe('sheet_sec_1');
    expect(sheet.date).toBe('2026-11-26 12:30:00');
  });
});
