import { describe, expect, it } from 'vitest';
import {
  BANK_CATALOG,
  createDefaultParserRegistry,
  parseRawMimeEmail,
  processIncomingEmail,
} from '../src/index.js';
import {
  CAKE_BROKEN_TEMPLATE_EMAIL,
  CAKE_HTML_TABLE_EMAIL,
  CAKE_INLINE_COLON_EMAIL,
  CAKE_MULTILINE_SPLIT_EMAIL,
  CAKE_OUTGOING_EMAIL,
  CAKE_PROMO_EMAIL,
  CAKE_RAW_MIME_QUOTED_PRINTABLE,
  CAKE_SPOOFED_UNALIGNED_DKIM_EMAIL,
  GMAIL_FORWARDING_CONFIRMATION_EMAIL,
} from './fixtures/cake-emails.js';

describe('Cake Email Parser & MIME Pipeline', () => {
  it('parses Cake 2-column HTML table incoming email with verified DKIM', async () => {
    const res = await processIncomingEmail(CAKE_HTML_TABLE_EMAIL, {
      expectedAccountNo: '0835117727',
    });

    expect(res.outcome).toBe('parsed');
    if (res.outcome !== 'parsed') return;

    expect(res.transaction.id).toBe('cake_FT26330123456789');
    expect(res.transaction.bankCode).toBe('CAKE');
    expect(res.transaction.bankBin).toBe(BANK_CATALOG.CAKE.bin);
    expect(res.transaction.amount).toBe(80000);
    expect(res.transaction.direction).toBe('in');
    expect(res.transaction.accountNumber).toBe('0835117727');
    expect(res.transaction.content).toBe('MUA950961');
    expect(res.transaction.senderName).toBe('NGUYEN VAN A');
    expect(res.transaction.senderBank).toBe('VCB');
    expect(res.transaction.auth.status).toBe('verified');
    expect(res.transaction.isTest).toBe(false);
    expect(res.transaction.occurredAt).toBe('2026-11-26T02:15:02.000Z');
  });

  it('parses Cake inline colon layout and multiline split layout', async () => {
    const r1 = await processIncomingEmail(CAKE_INLINE_COLON_EMAIL, {
      expectedAccountNo: '0835117727',
    });
    expect(r1.outcome).toBe('parsed');
    if (r1.outcome === 'parsed') {
      expect(r1.transaction.amount).toBe(150000);
      expect(r1.transaction.txId).toBe('CK202611260001');
      expect(r1.transaction.content).toBe('NAP 881122');
    }

    const r2 = await processIncomingEmail(CAKE_MULTILINE_SPLIT_EMAIL, {
      expectedAccountNo: '0835117727',
    });
    expect(r2.outcome).toBe('parsed');
    if (r2.outcome === 'parsed') {
      expect(r2.transaction.amount).toBe(250000);
      expect(r2.transaction.txId).toBe('FT9988776655');
      expect(r2.transaction.content).toBe('BOT778899');
    }
  });

  it('decodes raw RFC822 MIME with UTF-8 quoted-printable Vietnamese characters intact', async () => {
    const decoded = parseRawMimeEmail(CAKE_RAW_MIME_QUOTED_PRINTABLE);
    expect(decoded.subject).toBe('Thông báo biến động số dư');

    const res = await processIncomingEmail({
      source: 'email_worker',
      from: '',
      rawMime: CAKE_RAW_MIME_QUOTED_PRINTABLE,
    });

    expect(res.outcome).toBe('parsed');
    if (res.outcome !== 'parsed') return;
    expect(res.transaction.amount).toBe(120000);
    expect(res.transaction.txId).toBe('FTQP20261126');
    expect(res.transaction.content).toBe('MUA112233 thanh toán đơn');
  });

  it('quarantines spoofed emails with unaligned DKIM domain', async () => {
    const res = await processIncomingEmail(CAKE_SPOOFED_UNALIGNED_DKIM_EMAIL);
    expect(res.outcome).toBe('quarantined');
    if (res.outcome !== 'quarantined') return;
    expect(res.auth.status).toBe('spoof_suspected');
    expect(res.reason).toContain('attacker-domain.com');
  });

  it('quarantines broken transaction template emails instead of silently dropping them', async () => {
    const res = await processIncomingEmail(CAKE_BROKEN_TEMPLATE_EMAIL);
    expect(res.outcome).toBe('quarantined');
    if (res.outcome !== 'quarantined') return;
    expect(res.bankCode).toBe('CAKE');
    expect(res.reason).toContain('Số tiền');
  });

  it('ignores outgoing transfers, account mismatches, and promotional emails', async () => {
    const outgoing = await processIncomingEmail(CAKE_OUTGOING_EMAIL);
    expect(outgoing.outcome).toBe('ignored');

    const promo = await processIncomingEmail(CAKE_PROMO_EMAIL);
    expect(promo.outcome).toBe('ignored');

    const mismatch = await processIncomingEmail(CAKE_HTML_TABLE_EMAIL, {
      expectedAccountNo: '9999999999',
    });
    expect(mismatch.outcome).toBe('ignored');
  });

  it('detects Gmail auto-forwarding confirmation emails', async () => {
    const res = await processIncomingEmail(GMAIL_FORWARDING_CONFIRMATION_EMAIL);
    expect(res.outcome).toBe('forwarding_confirmation');
    if (res.outcome !== 'forwarding_confirmation') return;
    expect(res.confirmation.confirmationCode).toBe('482910374');
    expect(res.confirmation.confirmationUrl).toContain('mail-settings.google.com/mail/vf-');
    expect(res.confirmation.requesterEmail).toBe('shopowner@gmail.com');
  });

  it('supports registering custom bank parsers in BankParserRegistry', () => {
    const registry = createDefaultParserRegistry();
    expect(registry.get('CAKE')).toBeDefined();
    expect(registry.get('MB')).toBeDefined();
    expect(registry.get('VCB')).toBeDefined();
    expect(registry.get('TECHCOMBANK')).toBeDefined();
    expect(registry.get('TIMO')).toBeDefined();
    expect(registry.get('ACB')).toBeDefined();
    expect(registry.list().length).toBe(6);
  });

  it('prefers MIME From: over SMTP envelope from for Gmail auto-forwarding alignment', async () => {
    const gmailForwardedMime = [
      'Authentication-Results: mx.cloudflare.net; arc=pass; spf=pass smtp.mailfrom=gmail.com',
      'ARC-Seal: i=1; a=rsa-sha256; t=1700000000; cv=none; d=google.com; s=arc-20240605; b=sig',
      'ARC-Authentication-Results: i=1; mx.google.com; dkim=pass header.d=cake.vn; dmarc=pass',
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      'To: acc_demo@in.comey.vn',
      'Subject: Thong bao bien dong so du',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +50.000 đ',
      'Mã giao dịch: FTGMAILFWD01',
      'Nội dung giao dịch: SHOP100200',
    ].join('\r\n');

    const res = await processIncomingEmail(
      {
        source: 'email_worker',
        from: 'shopowner+caf_=acc_demo=in.comey.vn@gmail.com',
        envelopeFrom: 'shopowner+caf_=acc_demo=in.comey.vn@gmail.com',
        rawMime: gmailForwardedMime,
      },
      { expectedAccountNo: '0835117727' }
    );
    expect(res.outcome).toBe('parsed');
    if (res.outcome !== 'parsed') return;
    expect(res.transaction.amount).toBe(50000);
    expect(res.transaction.auth.status).toBe('verified');
    expect(res.transaction.auth.headerFrom).toBe('no-reply@cake.vn');
    expect(res.transaction.auth.envelopeFrom).toBe('shopowner+caf_=acc_demo=in.comey.vn@gmail.com');
  });

  it('quarantines MIME with forged lower Authentication-Results header', async () => {
    const forgedMime = [
      'Authentication-Results: mx.cloudflare.net; dkim=fail header.d=cake.vn',
      'Authentication-Results: forged.mx; dkim=pass header.d=cake.vn',
      'From: "Cake by VPBank" <no-reply@cake.vn>',
      'To: acc_demo@in.comey.vn',
      'Subject: Thong bao bien dong so du',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Tài khoản nhận: 0835117727',
      'Số tiền: +1.000.000 đ',
      'Mã giao dịch: FTFORGED01',
      'Nội dung giao dịch: SHOP999',
    ].join('\r\n');

    const res = await processIncomingEmail({
      source: 'email_worker',
      from: 'no-reply@cake.vn',
      rawMime: forgedMime,
    });
    expect(res.outcome).toBe('quarantined');
    if (res.outcome !== 'quarantined') return;
    expect(res.auth.status).toBe('spoof_suspected');
  });

  it('strictly parses VND amounts without concatenating trailing numbers or allowing unsafe overflow', async () => {
    const makeEmail = (amtLine: string, txId = 'FTAMT0001') => ({
      ...CAKE_INLINE_COLON_EMAIL,
      textBody: [
        'Tài khoản nhận: 0835117727',
        `Số tiền: ${amtLine}`,
        `Mã giao dịch: ${txId}`,
        'Nội dung giao dịch: ORDER01',
      ].join('\n'),
    });

    const withFee = await processIncomingEmail(makeEmail('+50.000 đ (Phí: 0 đ)', 'FTAMT0001'));
    expect(withFee.outcome).toBe('parsed');
    if (withFee.outcome === 'parsed') expect(withFee.transaction.amount).toBe(50000);

    const withCommaZero = await processIncomingEmail(makeEmail('+50.000,00 VND', 'FTAMT0002'));
    expect(withCommaZero.outcome).toBe('parsed');
    if (withCommaZero.outcome === 'parsed') expect(withCommaZero.transaction.amount).toBe(50000);

    const withDotZero = await processIncomingEmail(makeEmail('+50,000.00 VND', 'FTAMT0003'));
    expect(withDotZero.outcome).toBe('parsed');
    if (withDotZero.outcome === 'parsed') expect(withDotZero.transaction.amount).toBe(50000);

    const maxAllowed = await processIncomingEmail(makeEmail('+10.000.000.000 đ', 'FTAMT0004'));
    expect(maxAllowed.outcome).toBe('parsed');
    if (maxAllowed.outcome === 'parsed') expect(maxAllowed.transaction.amount).toBe(10_000_000_000);

    const overMax = await processIncomingEmail(makeEmail('+10.000.000.001 đ', 'FTAMT0005'));
    expect(overMax.outcome).toBe('quarantined');

    const unsafeOverflow = await processIncomingEmail(
      makeEmail('+99999999999999999999 đ', 'FTAMT0006')
    );
    expect(unsafeOverflow.outcome).toBe('quarantined');

    const nonZeroCents = await processIncomingEmail(makeEmail('+50.000,50 VND', 'FTAMT0007'));
    expect(nonZeroCents.outcome).toBe('quarantined');
  });

  it('uses exact or explicit mask-aware receiver account matching (no substring hijack)', async () => {
    const makeAccEmail = (accLine: string) => ({
      ...CAKE_INLINE_COLON_EMAIL,
      textBody: [
        `Tài khoản nhận: ${accLine}`,
        'Số tiền: +50.000 đ',
        'Mã giao dịch: FTACC0001',
        'Nội dung giao dịch: ORDER01',
      ].join('\n'),
    });

    // Substring match MUST fail
    const superstring = await processIncomingEmail(makeAccEmail('108351177279'), {
      expectedAccountNo: '0835117727',
    });
    expect(superstring.outcome).toBe('ignored');

    const extraDigit = await processIncomingEmail(makeAccEmail('08351177270'), {
      expectedAccountNo: '0835117727',
    });
    expect(extraDigit.outcome).toBe('ignored');

    // Exact match with trailing description digits succeeds
    const withDesc = await processIncomingEmail(makeAccEmail('0835117727 - Tài khoản 2'), {
      expectedAccountNo: '0835117727',
    });
    expect(withDesc.outcome).toBe('parsed');

    // Explicit mask-aware matches succeed
    const maskedPrefix = await processIncomingEmail(makeAccEmail('******7727'), {
      expectedAccountNo: '0835117727',
    });
    expect(maskedPrefix.outcome).toBe('parsed');

    const maskedMiddle = await processIncomingEmail(makeAccEmail('083***7727'), {
      expectedAccountNo: '0835117727',
    });
    expect(maskedMiddle.outcome).toBe('parsed');

    // Non-matching mask fails
    const maskedWrong = await processIncomingEmail(makeAccEmail('******9999'), {
      expectedAccountNo: '0835117727',
    });
    expect(maskedWrong.outcome).toBe('ignored');
  });

  it('normalizes txId to uppercase in transaction idempotency key', async () => {
    const lower = await processIncomingEmail({
      ...CAKE_INLINE_COLON_EMAIL,
      textBody: [
        'Tài khoản nhận: 0835117727',
        'Số tiền: +50.000 đ',
        'Mã giao dịch: ftcase123',
        'Nội dung giao dịch: ORDER01',
      ].join('\n'),
    });
    const upper = await processIncomingEmail({
      ...CAKE_INLINE_COLON_EMAIL,
      textBody: [
        'Tài khoản nhận: 0835117727',
        'Số tiền: +50.000 đ',
        'Mã giao dịch: FTCASE123',
        'Nội dung giao dịch: ORDER01',
      ].join('\n'),
    });
    expect(lower.outcome).toBe('parsed');
    expect(upper.outcome).toBe('parsed');
    if (lower.outcome === 'parsed' && upper.outcome === 'parsed') {
      expect(lower.transaction.id).toBe('cake_FTCASE123');
      expect(upper.transaction.id).toBe('cake_FTCASE123');
    }
  });

  it('handles malformed base64 and deeply nested MIME safely without crashing', () => {
    const malformedB64Mime = [
      'From: no-reply@cake.vn',
      'Subject: Broken base64',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      '!!!not-valid-base64-at-all@@@',
    ].join('\r\n');
    expect(() => parseRawMimeEmail(malformedB64Mime)).not.toThrow();

    // 25 levels of nested multipart MUST cap cleanly at MAX_MIME_DEPTH without recursion blowup
    let nested = 'Content-Type: text/plain\r\n\r\nDeep body';
    for (let i = 25; i >= 1; i--) {
      const b = `bnd_depth_${i}`;
      nested = `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\n${nested}\r\n--${b}--`;
    }
    const deepMime = `From: no-reply@cake.vn\r\n${nested}`;
    expect(() => parseRawMimeEmail(deepMime)).not.toThrow();
    const parsedDeep = parseRawMimeEmail(deepMime);
    expect(parsedDeep.textBody).toBeUndefined();
  });

  it('parses large ~150KB HTML Cake emails accurately and quickly', async () => {
    const styleBlock = `<style>${'.x{color:#333;padding:4px;}'.repeat(1200)}</style>`;
    const promoTail = '<div><p>Ưu đãi Cake &amp; đối tác &#160; hoàn tiền!</p></div>'.repeat(1800);
    const largeHtml = `<html><head>${styleBlock}</head><body>${CAKE_HTML_TABLE_EMAIL.htmlBody}${promoTail}</body></html>`;
    expect(largeHtml.length).toBeGreaterThan(140_000);

    const start = performance.now();
    const res = await processIncomingEmail(
      {
        ...CAKE_HTML_TABLE_EMAIL,
        htmlBody: largeHtml,
        textBody: 'unused plain fallback '.repeat(2000),
      },
      { expectedAccountNo: '0835117727' }
    );
    const elapsedMs = performance.now() - start;

    expect(res.outcome).toBe('parsed');
    if (res.outcome === 'parsed') {
      expect(res.transaction.amount).toBe(80000);
      expect(res.transaction.txId).toBe('FT26330123456789');
    }
    // Generous wall-time sanity threshold to avoid CI flakiness while catching O(N^2) regressions
    expect(elapsedMs).toBeLessThan(200);
  });
});
