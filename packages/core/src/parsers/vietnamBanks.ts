import { BANK_CATALOG } from '../banks/catalog.js';
import { extractDomain } from '../security/emailAuth.js';
import type {
  BankEmailParser,
  BankMetadata,
  ParseResult,
  RawEmailInput,
} from '../types.js';
import {
  buildDeterministicTxId,
  extractAccountToken,
  isOutgoingAmountText,
  matchesAccountNumber,
  parseStrictIncomingVndAmount,
} from './common.js';
import {
  extractFieldAfterLabel,
  htmlToStructuredLines,
  parseVietnameseDateTime,
} from './htmlUtils.js';

export interface GenericVnBankParserConfig {
  bank: BankMetadata;
  domains: readonly string[];
  accountLabels: string;
  amountLabels: string;
  dateLabels: string;
  txIdLabels: string;
  contentLabels: string;
  senderLabels?: string;
  senderBankLabels?: string;
  likelyTxRegex: RegExp;
  footerStopRegex?: RegExp;
}

function domainMatchesList(senderFrom: string, domains: readonly string[]): boolean {
  const domain = extractDomain(senderFrom);
  if (!domain) return false;
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function parseLinesWithConfig(
  lines: string[],
  email: RawEmailInput,
  config: GenericVnBankParserConfig,
  expectedAccountNo?: string
): ParseResult {
  let cachedJoined: string | null = null;
  const getJoinedText = (): string => {
    if (cachedJoined === null) {
      cachedJoined = lines.join('\n');
    }
    return cachedJoined;
  };

  let amountRaw = extractFieldAfterLabel(lines, config.amountLabels);
  if (!amountRaw) {
    const joined = getJoinedText();
    const labelFallback = joined.match(
      new RegExp(`(?:${config.amountLabels})[\\s\\t:]*([+-]?\\s*\\d[\\d.,]*\\s*(?:đ|₫|VND)?)`, 'i')
    );
    if (labelFallback?.[1]) {
      amountRaw = labelFallback[1];
    } else {
      const inlineSigned = joined.match(
        /(?<![A-Za-z0-9])([+-]\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]00)?\s*(?:đ|₫|VND)|[+-]\s*\d{4,12}\s*(?:đ|₫|VND))/i
      );
      if (inlineSigned?.[1]) {
        amountRaw = inlineSigned[1];
      }
    }
  }

  if (!amountRaw) {
    const combined = `${email.subject || ''}\n${getJoinedText()}`;
    const likelyTx = config.likelyTxRegex.test(combined);
    return {
      ok: false,
      ignored: !likelyTx,
      quarantine: likelyTx,
      reason: likelyTx
        ? `${config.bank.shortName} transaction email missing amount field`
        : `Non-transaction email from ${config.domains[0]}`,
      debugLines: lines.slice(0, 12),
    };
  }

  const trimmedAmt = amountRaw.trim();
  if (isOutgoingAmountText(trimmedAmt)) {
    return {
      ok: false,
      ignored: true,
      outgoing: true,
      quarantine: false,
      reason: `Outgoing transfer ignored (${amountRaw})`,
    };
  }

  const transferAmount = parseStrictIncomingVndAmount(trimmedAmt, {
    allowUnsignedPositive: true,
  });
  if (transferAmount === null) {
    return {
      ok: false,
      quarantine: true,
      reason: `Invalid ${config.bank.shortName} transfer amount (${amountRaw})`,
      debugLines: lines.slice(0, 12),
    };
  }

  let receiverRaw = extractFieldAfterLabel(lines, config.accountLabels);
  if (!receiverRaw) {
    const fallbackAcc = getJoinedText().match(
      new RegExp(`(?:${config.accountLabels})[\\s\\t:]*([^\\n]+)`, 'i')
    );
    if (fallbackAcc?.[1]) receiverRaw = fallbackAcc[1].trim();
  }

  const receiverToken = extractAccountToken(receiverRaw);
  const cleanReceiverDigits = receiverToken.replace(/\D/g, '');
  if (!receiverToken || !cleanReceiverDigits) {
    return {
      ok: false,
      quarantine: true,
      reason: `Missing receiver account number in ${config.bank.shortName} email`,
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

  const dateRaw = extractFieldAfterLabel(lines, config.dateLabels);
  const occurredAt = parseVietnameseDateTime(dateRaw, email.date);

  let contentRaw = extractFieldAfterLabel(lines, config.contentLabels);
  if (!contentRaw) {
    const fallbackContent = getJoinedText().match(
      new RegExp(`(?:${config.contentLabels})[\\s\\t:]+([^\\n]+)`, 'i')
    );
    if (fallbackContent?.[1]) contentRaw = fallbackContent[1];
  }
  const content = (
    config.footerStopRegex
      ? String(contentRaw || '').replace(config.footerStopRegex, '')
      : String(contentRaw || '')
  ).trim();

  let txIdRaw = extractFieldAfterLabel(lines, config.txIdLabels);
  if (!txIdRaw) {
    const fallbackTx = getJoinedText().match(
      new RegExp(`(?:${config.txIdLabels})[\\s\\t:]*([A-Za-z0-9_-]{4,})`, 'i')
    );
    if (fallbackTx?.[1]) txIdRaw = fallbackTx[1];
  }
  let txId = String(txIdRaw || '').replace(/[^\w-]/g, '');
  if (!txId || txId.length < 4) {
    txId = buildDeterministicTxId(
      config.bank.code,
      transferAmount,
      occurredAt,
      content || email.messageId || ''
    );
  }

  const senderName = config.senderLabels
    ? extractFieldAfterLabel(lines, config.senderLabels)
    : '';
  const senderBank = config.senderBankLabels
    ? extractFieldAfterLabel(lines, config.senderBankLabels)
    : '';

  return {
    ok: true,
    transaction: {
      bankCode: config.bank.code,
      bankBin: config.bank.bin,
      txId,
      accountNumber: cleanExpected || cleanReceiverDigits,
      direction: 'in',
      amount: transferAmount,
      currency: 'VND',
      content,
      occurredAt,
      senderName: senderName || undefined,
      senderBank: senderBank || undefined,
      emailMessageId: email.messageId,
    },
  };
}

export function createBankEmailParser(
  config: GenericVnBankParserConfig
): BankEmailParser {
  return {
    bank: config.bank,

    canHandle(email: RawEmailInput): boolean {
      return domainMatchesList(email.from, config.domains);
    },

    parse(email: RawEmailInput, expectedAccountNo?: string): ParseResult {
      const htmlLines = email.htmlBody ? htmlToStructuredLines(email.htmlBody) : [];
      if (htmlLines.length > 0) {
        const res = parseLinesWithConfig(htmlLines, email, config, expectedAccountNo);
        if (res.ok || res.outgoing || !email.textBody) {
          return res;
        }
        const plainLines = htmlToStructuredLines(email.textBody);
        if (plainLines.length > 0) {
          const fallbackRes = parseLinesWithConfig(plainLines, email, config, expectedAccountNo);
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
      return parseLinesWithConfig(plainLines, email, config, expectedAccountNo);
    },
  };
}

export const mbEmailParser = createBankEmailParser({
  bank: BANK_CATALOG.MB,
  domains: BANK_CATALOG.MB.emailDomains,
  accountLabels: 'Tài khoản nhận|Tài khoản thụ hưởng|Số tài khoản|Tài khoản|TK',
  amountLabels: 'Số tiền|Biến động|Số tiền giao dịch',
  dateLabels: 'Thời gian giao dịch|Ngày giờ giao dịch|Thời gian|Ngày GD',
  txIdLabels: 'Mã giao dịch|Số tham chiếu|Ref',
  contentLabels: 'Nội dung chuyển tiền|Nội dung giao dịch|Nội dung|Diễn giải',
  senderLabels: 'Tên người chuyển|Người chuyển',
  senderBankLabels: 'Ngân hàng chuyển',
  likelyTxRegex: /mb\s*bank|biến động số dư|tài khoản|số tiền|giao dịch/i,
  footerStopRegex: /\s*(?:Trân trọng|Cảm ơn quý khách)[\s\S]*$/i,
});

export const vcbEmailParser = createBankEmailParser({
  bank: BANK_CATALOG.VCB,
  domains: BANK_CATALOG.VCB.emailDomains,
  accountLabels: 'Tài khoản ghi có|Số tài khoản|Tài khoản nhận|Tài khoản',
  amountLabels: 'Số tiền ghi có|Số tiền giao dịch|Số tiền',
  dateLabels: 'Thời gian giao dịch|Ngày giờ giao dịch|Ngày giao dịch|Thời gian',
  txIdLabels: 'Số lệnh giao dịch|Mã giao dịch|Số tham chiếu',
  contentLabels: 'Nội dung chuyển tiền|Nội dung giao dịch|Nội dung|Diễn giải',
  senderLabels: 'Tên người chuyển|Người chuyển',
  senderBankLabels: 'Ngân hàng chuyển',
  likelyTxRegex: /vietcombank|vcb|ghi có|số lệnh giao dịch|biến động số dư|số tiền/i,
  footerStopRegex: /\s*(?:Trân trọng|Cảm ơn quý khách)[\s\S]*$/i,
});

export const techcombankEmailParser = createBankEmailParser({
  bank: BANK_CATALOG.TECHCOMBANK,
  domains: BANK_CATALOG.TECHCOMBANK.emailDomains,
  accountLabels: 'Tài khoản nhận|Tài khoản thụ hưởng|Số tài khoản|Tài khoản',
  amountLabels: 'Số tiền giao dịch|Số tiền ghi có|Số tiền',
  dateLabels: 'Thời gian giao dịch|Ngày giờ giao dịch|Ngày giao dịch|Thời gian',
  txIdLabels: 'Số bút toán|Mã giao dịch|Số tham chiếu',
  contentLabels: 'Diễn giải|Nội dung giao dịch|Nội dung',
  senderLabels: 'Tên người chuyển|Người chuyển',
  senderBankLabels: 'Ngân hàng chuyển',
  likelyTxRegex: /techcombank|bút toán|diễn giải|biến động số dư|số tiền/i,
  footerStopRegex: /\s*(?:Trân trọng|Cảm ơn quý khách)[\s\S]*$/i,
});

export const timoEmailParser = createBankEmailParser({
  bank: BANK_CATALOG.TIMO,
  domains: BANK_CATALOG.TIMO.emailDomains,
  accountLabels: 'Tài khoản nhận|Spend Account|Số tài khoản|Tài khoản',
  amountLabels: 'Số tiền|Biến động|Amount',
  dateLabels: 'Ngày giờ giao dịch|Thời gian giao dịch|Thời gian|Date',
  txIdLabels: 'Mã giao dịch|Reference|Ref',
  contentLabels: 'Mô tả|Nội dung giao dịch|Nội dung|Description',
  senderLabels: 'Tên người chuyển|Người chuyển|From',
  senderBankLabels: 'Ngân hàng chuyển',
  likelyTxRegex: /timo|spend account|biến động|số tiền|giao dịch/i,
  footerStopRegex: /\s*(?:Cảm ơn bạn|Thân mến)[\s\S]*$/i,
});

export const acbEmailParser = createBankEmailParser({
  bank: BANK_CATALOG.ACB,
  domains: BANK_CATALOG.ACB.emailDomains,
  accountLabels: 'Tài khoản nhận|Số tài khoản|Tài khoản',
  amountLabels: 'Số tiền|Ghi có|Số tiền giao dịch',
  dateLabels: 'Ngày giờ|Thời gian giao dịch|Ngày giờ giao dịch|Thời gian',
  txIdLabels: 'Mã giao dịch|Số tham chiếu|Số bút toán',
  contentLabels: 'Nội dung|Nội dung giao dịch|Diễn giải',
  senderLabels: 'Tên người chuyển|Người chuyển',
  senderBankLabels: 'Ngân hàng chuyển',
  likelyTxRegex: /\bacb\b|biến động số dư|ghi có|số tiền|giao dịch/i,
  footerStopRegex: /\s*(?:Trân trọng|Cảm ơn quý khách)[\s\S]*$/i,
});
