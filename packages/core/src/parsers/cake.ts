import { BANK_CATALOG } from '../banks/catalog.js';
import { extractDomain } from '../security/emailAuth.js';
import type { BankEmailParser, ParseResult, RawEmailInput } from '../types.js';
import {
  extractFieldAfterLabel,
  htmlToStructuredLines,
  parseVietnameseDateTime,
} from './htmlUtils.js';
import {
  extractAccountToken,
  matchesAccountNumber,
  parseStrictIncomingVndAmount,
} from './common.js';

function stripTrailingEmailFooter(content: string): string {
  const c = String(content || '').trim();
  if (/^(?:Cảm ơn bạn|Thân mến|Phí giao dịch|Ngày giờ giao dịch|Mã giao dịch|Thông tin)/i.test(c)) {
    return '';
  }
  return c.replace(/\s*Cảm ơn bạn đã sử dụng dịch vụ[\s\S]*$/i, '').trim();
}

function isLikelyTransactionNotification(lines: string[], subject?: string): boolean {
  const combined = `${subject || ''}\n${lines.join('\n')}`;
  return /biến động số dư|thông báo giao dịch|số tiền|tài khoản nhận|mã giao dịch/i.test(combined);
}

function parseCakeLines(
  lines: string[],
  email: RawEmailInput,
  expectedAccountNo?: string
): ParseResult {
  let cachedJoinedText: string | null = null;
  const getJoinedText = (): string => {
    if (cachedJoinedText === null) {
      cachedJoinedText = lines.join('\n');
    }
    return cachedJoinedText;
  };

  let amountRaw = extractFieldAfterLabel(lines, 'Số tiền');
  if (!amountRaw) {
    const fallbackAmt = getJoinedText().match(
      /Số tiền[\s\t:]*([+-]?\s*\d[\d.,]*\s*(?:đ|₫|VND)?)/i
    );
    if (fallbackAmt?.[1]) amountRaw = fallbackAmt[1];
  }

  if (!amountRaw) {
    const likelyTx = isLikelyTransactionNotification(lines, email.subject);
    return {
      ok: false,
      ignored: !likelyTx,
      quarantine: likelyTx,
      reason: likelyTx
        ? 'Cake transaction email missing Số tiền field'
        : 'Non-transaction email from cake.vn',
      debugLines: lines.slice(0, 12),
    };
  }

  const trimmedAmt = amountRaw.trim();
  if (trimmedAmt.charAt(0) === '-') {
    return {
      ok: false,
      ignored: true,
      outgoing: true,
      quarantine: false,
      reason: `Outgoing transfer ignored (${amountRaw})`,
    };
  }
  if (trimmedAmt.charAt(0) !== '+') {
    return {
      ok: false,
      quarantine: true,
      reason: `Amount does not start with '+' (${amountRaw})`,
      debugLines: lines.slice(0, 12),
    };
  }

  const transferAmount = parseStrictIncomingVndAmount(trimmedAmt);
  if (transferAmount === null) {
    return {
      ok: false,
      quarantine: true,
      reason: `Invalid transfer amount (${amountRaw})`,
      debugLines: lines.slice(0, 12),
    };
  }

  let receiverAccount = extractFieldAfterLabel(
    lines,
    'Tài khoản nhận|Tài khoản thụ hưởng|Số tài khoản nhận'
  );
  if (!receiverAccount) {
    const fallbackAcc = getJoinedText().match(
      /(?:Tài khoản nhận|Tài khoản thụ hưởng|Số tài khoản nhận)[\s\t:]*([^\n]+)/i
    );
    if (fallbackAcc?.[1]) receiverAccount = fallbackAcc[1].trim();
  }

  const receiverToken = extractAccountToken(receiverAccount);
  const cleanReceiverDigits = receiverToken.replace(/\D/g, '');
  if (!receiverToken || !cleanReceiverDigits) {
    return {
      ok: false,
      quarantine: true,
      reason: 'Missing receiver account number',
      debugLines: lines.slice(0, 12),
    };
  }

  const cleanExpected = String(expectedAccountNo || '').replace(/\D/g, '');
  if (cleanExpected && !matchesAccountNumber(receiverToken, cleanExpected)) {
    return {
      ok: false,
      ignored: true,
      quarantine: false,
      reason: `Account mismatch (got ${receiverToken}, expected ${cleanExpected})`,
    };
  }

  let txIdRaw = extractFieldAfterLabel(lines, 'Mã giao dịch');
  if (!txIdRaw) {
    const fallbackTx = getJoinedText().match(/Mã giao dịch[\s\t:]*([A-Za-z0-9_-]{4,})/i);
    if (fallbackTx?.[1]) txIdRaw = fallbackTx[1];
  }
  const txId = String(txIdRaw || '').replace(/[^\w-]/g, '');
  if (!txId || txId.length < 4) {
    return {
      ok: false,
      quarantine: true,
      reason: `Missing or invalid Mã giao dịch (${txIdRaw})`,
      debugLines: lines.slice(0, 12),
    };
  }

  const txDateRaw = extractFieldAfterLabel(lines, 'Ngày giờ giao dịch');
  const senderName = extractFieldAfterLabel(lines, 'Tên người chuyển');
  const senderBank = extractFieldAfterLabel(lines, 'Ngân hàng chuyển');
  let contentRaw = extractFieldAfterLabel(lines, 'Nội dung giao dịch');
  if (!contentRaw) {
    const fallbackContent = getJoinedText().match(/Nội dung giao dịch[\s\t:]+([^\n]+)/i);
    if (fallbackContent?.[1]) contentRaw = fallbackContent[1];
  }
  const content = stripTrailingEmailFooter(contentRaw);

  return {
    ok: true,
    transaction: {
      bankCode: BANK_CATALOG.CAKE.code,
      bankBin: BANK_CATALOG.CAKE.bin,
      txId,
      accountNumber: cleanExpected || cleanReceiverDigits,
      direction: 'in',
      amount: transferAmount,
      currency: 'VND',
      content,
      occurredAt: parseVietnameseDateTime(txDateRaw, email.date),
      senderName: senderName || undefined,
      senderBank: senderBank || undefined,
      emailMessageId: email.messageId,
    },
  };
}

export const cakeEmailParser: BankEmailParser = {
  bank: BANK_CATALOG.CAKE,

  canHandle(email: RawEmailInput): boolean {
    const domain = extractDomain(email.from);
    return domain === 'cake.vn' || Boolean(domain && domain.endsWith('.cake.vn'));
  },

  parse(email: RawEmailInput, expectedAccountNo?: string): ParseResult {
    const htmlLines = email.htmlBody ? htmlToStructuredLines(email.htmlBody) : [];
    if (htmlLines.length > 0) {
      const res = parseCakeLines(htmlLines, email, expectedAccountNo);
      if (res.ok || res.outgoing || !email.textBody) {
        return res;
      }
      // Lazy fallback: only parse textBody when htmlLines fails to yield a transaction
      const plainLines = htmlToStructuredLines(email.textBody);
      if (plainLines.length > 0) {
        const fallbackRes = parseCakeLines(plainLines, email, expectedAccountNo);
        if (fallbackRes.ok || fallbackRes.outgoing) {
          return fallbackRes;
        }
      }
      return res;
    }

    const plainLines = email.textBody ? htmlToStructuredLines(email.textBody) : [];
    if (plainLines.length === 0) {
      return {
        ok: false,
        quarantine: true,
        reason: 'Empty email body',
      };
    }
    return parseCakeLines(plainLines, email, expectedAccountNo);
  },
};
