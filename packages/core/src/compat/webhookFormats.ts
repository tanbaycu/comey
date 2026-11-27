import { timingSafeEqual } from '../security/crypto.js';
import type { UnifiedTransaction } from '../types.js';

export type WebhookPayloadFormat =
  | 'comey'
  | 'sepay'
  | 'payos'
  | 'telegram'
  | 'discord'
  | 'google_sheets';

export const WEBHOOK_PAYLOAD_FORMATS: readonly WebhookPayloadFormat[] = [
  'comey',
  'sepay',
  'payos',
  'telegram',
  'discord',
  'google_sheets',
] as const;

const VI_NUMBER_FORMAT = new Intl.NumberFormat('vi-VN');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format an ISO timestamp or Date in Vietnam local time (UTC+7) as "YYYY-MM-DD HH:mm:ss",
 * matching the datetime string expected by SePay and PayOS webhook consumers.
 */
export function formatVnDateTimeString(isoOrDate: string | Date): string {
  const parsed = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const safeMs = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  const vnDate = new Date(safeMs + VN_OFFSET_MS);

  const year = vnDate.getUTCFullYear();
  const month = pad2(vnDate.getUTCMonth() + 1);
  const day = pad2(vnDate.getUTCDate());
  const hours = pad2(vnDate.getUTCHours());
  const minutes = pad2(vnDate.getUTCMinutes());
  const seconds = pad2(vnDate.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const BANK_GATEWAY_LABELS: Record<string, string> = {
  cake: 'CAKE',
  mbbank: 'MBBank',
  vietcombank: 'Vietcombank',
  techcombank: 'Techcombank',
  acb: 'ACB',
  vpbank: 'VPBank',
  tpbank: 'TPBank',
  bidv: 'BIDV',
  vietinbank: 'VietinBank',
  sacombank: 'Sacombank',
  timo: 'Timo',
  vib: 'VIB',
};

function resolveGatewayName(bankCode: string): string {
  const normalized = bankCode.trim().toLowerCase();
  return BANK_GATEWAY_LABELS[normalized] ?? (bankCode.trim().toUpperCase() || 'UNKNOWN');
}

function fnv1aPositiveInt(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

function extractPaymentCode(content: string): string | null {
  const match = /\b(CM[A-Z0-9]{4,20})\b/i.exec(content);
  return match?.[1]?.toUpperCase() ?? null;
}

export interface SePayWebhookPayload {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  code: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated: number;
  subAccount: string | null;
  referenceCode: string;
  description: string;
}

export interface FormatSePayWebhookOptions {
  id?: number;
  gateway?: string;
  accumulated?: number;
  subAccount?: string | null;
  code?: string | null;
  referenceCode?: string;
}

/**
 * Format a UnifiedTransaction into a SePay-compatible webhook JSON payload.
 * Intended to be sent with `Authorization: Apikey <secret>`.
 */
export function formatSePayWebhookPayload(
  tx: UnifiedTransaction,
  options?: FormatSePayWebhookOptions
): SePayWebhookPayload {
  return {
    id: options?.id ?? fnv1aPositiveInt(`${tx.id}:${tx.txId}`),
    gateway: options?.gateway ?? resolveGatewayName(tx.bankCode),
    transactionDate: formatVnDateTimeString(tx.occurredAt),
    accountNumber: tx.accountNumber,
    code: options?.code !== undefined ? options.code : extractPaymentCode(tx.content),
    content: tx.content,
    transferType: tx.direction,
    transferAmount: tx.amount,
    accumulated: options?.accumulated ?? 0,
    subAccount: options?.subAccount ?? null,
    referenceCode: options?.referenceCode ?? tx.txId,
    description: tx.content,
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortObjectKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

function serializePayOSValue(value: unknown): string {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') {
    return '';
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(sortObjectKeys));
  }
  if (typeof value === 'object') {
    return JSON.stringify(sortObjectKeys(value));
  }
  return String(value);
}

/**
 * Build PayOS canonical query string by sorting keys alphabetically
 * and joining `key=value` pairs with `&`.
 */
export function buildPayOSCanonicalString(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .map((key) => `${key}=${serializePayOSValue(data[key])}`)
    .join('&');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 1) {
    out += (view[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Compute PayOS HMAC-SHA256 hex signature over a `data` object using `checksumKey`.
 */
export async function signPayOSData(
  data: Record<string, unknown>,
  checksumKey: string
): Promise<string> {
  if (!checksumKey || typeof checksumKey !== 'string') {
    throw new Error('checksumKey must be a non-empty string');
  }
  const canonical = buildPayOSCanonicalString(data);
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder.encode(checksumKey)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    toArrayBuffer(textEncoder.encode(canonical))
  );
  return bytesToHex(mac);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Verify a PayOS webhook `signature` against `payload.data` using `checksumKey`.
 */
export async function verifyPayOSWebhookSignature(
  payload: { data: Record<string, unknown>; signature: string },
  checksumKey: string
): Promise<boolean> {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (!checksumKey || typeof checksumKey !== 'string') {
    return false;
  }
  if (!isPlainRecord(payload.data)) {
    return false;
  }
  if (!payload.signature || typeof payload.signature !== 'string') {
    return false;
  }
  const normalizedSig = payload.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedSig)) {
    return false;
  }
  try {
    const expected = await signPayOSData(payload.data, checksumKey);
    return timingSafeEqual(expected, normalizedSig);
  } catch {
    return false;
  }
}

export interface PayOSWebhookData extends Record<string, unknown> {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference: string;
  transactionDateTime: string;
  currency: string;
  paymentLinkId: string;
  code: string;
  desc: string;
  counterAccountBankId: string;
  counterAccountBankName: string;
  counterAccountName: string;
  counterAccountNumber: string;
  virtualAccountName: string;
  virtualAccountNumber: string;
}

export interface PayOSWebhookPayload {
  code: string;
  desc: string;
  success: boolean;
  data: PayOSWebhookData;
  signature: string;
}

export interface FormatPayOSWebhookOptions {
  orderCode?: number;
  paymentLinkId?: string;
  counterAccountBankId?: string;
  desc?: string;
}

function deriveNumericOrderCode(tx: UnifiedTransaction): number {
  const content = String(tx.content || '');
  const prefixedMatch = /(?<![A-Z0-9])[A-Z]{1,12}[-_]?(\d{4,12})(?![A-Z0-9])/i.exec(content);
  if (prefixedMatch?.[1]) {
    const parsed = Number(prefixedMatch[1]);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const digitsMatch = /\b(\d{4,12})\b/.exec(content);
  if (digitsMatch?.[1]) {
    const parsed = Number(digitsMatch[1]);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fnv1aPositiveInt(`${tx.id}:${tx.txId}`);
}

/**
 * Format and sign a UnifiedTransaction into a PayOS-compatible webhook JSON payload.
 */
export async function formatPayOSWebhookPayload(
  tx: UnifiedTransaction,
  checksumKey: string,
  options?: FormatPayOSWebhookOptions
): Promise<PayOSWebhookPayload> {
  const data: PayOSWebhookData = {
    orderCode: options?.orderCode ?? deriveNumericOrderCode(tx),
    amount: tx.amount,
    description: tx.content,
    accountNumber: tx.accountNumber,
    reference: tx.txId,
    transactionDateTime: formatVnDateTimeString(tx.occurredAt),
    currency: tx.currency,
    paymentLinkId: options?.paymentLinkId ?? tx.id,
    code: '00',
    desc: 'success',
    counterAccountBankId: options?.counterAccountBankId ?? '',
    counterAccountBankName: tx.senderBank ?? '',
    counterAccountName: tx.senderName ?? '',
    counterAccountNumber: '',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };

  const signature = await signPayOSData(data, checksumKey);
  return {
    code: '00',
    desc: options?.desc ?? 'success',
    success: true,
    data,
    signature,
  };
}

function escapeTelegramHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface TelegramMessagePayload {
  chat_id: string;
  parse_mode: 'HTML';
  disable_web_page_preview: true;
  text: string;
}

/**
 * Format a UnifiedTransaction into a Telegram Bot API `sendMessage` HTML payload.
 */
export function formatTelegramMessagePayload(
  tx: UnifiedTransaction,
  chatId: string
): TelegramMessagePayload {
  const gateway = escapeTelegramHtml(resolveGatewayName(tx.bankCode));
  const amountFormatted = `+${VI_NUMBER_FORMAT.format(tx.amount)} đ`;
  const prefix = tx.isTest ? '🧪 <b>[TEST] Nhận tiền giả lập</b>' : '✅ <b>Nhận tiền chuyển khoản</b>';
  const lines = [
    prefix,
    `🏦 Ngân hàng: <b>${gateway}</b> (<code>${escapeTelegramHtml(tx.accountNumber)}</code>)`,
    `💰 Số tiền: <b>${amountFormatted}</b>`,
    `📝 Nội dung: <code>${escapeTelegramHtml(tx.content || '(trống)')}</code>`,
  ];
  if (tx.senderName) {
    const bankSuffix = tx.senderBank ? ` (${escapeTelegramHtml(tx.senderBank)})` : '';
    lines.push(`👤 Người gửi: ${escapeTelegramHtml(tx.senderName)}${bankSuffix}`);
  }
  lines.push(`🔖 Mã GD: <code>${escapeTelegramHtml(tx.txId)}</code>`);
  lines.push(`🕒 Lúc: ${formatVnDateTimeString(tx.occurredAt)}`);

  return {
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: lines.join('\n'),
  };
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookPayload {
  username: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: DiscordEmbedField[];
    footer: { text: string };
    timestamp: string;
  }>;
}

/**
 * Format a UnifiedTransaction into a Discord Incoming Webhook Embed payload.
 */
export function formatDiscordWebhookPayload(
  tx: UnifiedTransaction
): DiscordWebhookPayload {
  const gateway = resolveGatewayName(tx.bankCode);
  const amountFormatted = `+${VI_NUMBER_FORMAT.format(tx.amount)} đ`;
  const title = tx.isTest
    ? `🧪 [TEST] +${VI_NUMBER_FORMAT.format(tx.amount)} đ (${gateway})`
    : `💸 +${VI_NUMBER_FORMAT.format(tx.amount)} đ (${gateway})`;

  const fields: DiscordEmbedField[] = [
    { name: 'Số tiền', value: `**${amountFormatted}**`, inline: true },
    { name: 'Ngân hàng', value: `${gateway} · \`${tx.accountNumber}\``, inline: true },
    { name: 'Nội dung', value: tx.content ? `\`${tx.content.slice(0, 500)}\`` : '(trống)' },
    { name: 'Mã giao dịch', value: `\`${tx.txId}\``, inline: true },
    { name: 'Giờ VN', value: formatVnDateTimeString(tx.occurredAt), inline: true },
  ];

  if (tx.senderName) {
    fields.push({
      name: 'Người chuyển',
      value: tx.senderBank ? `${tx.senderName} (${tx.senderBank})` : tx.senderName,
      inline: true,
    });
  }

  return {
    username: 'Comey Pay',
    embeds: [
      {
        title,
        description: tx.isTest
          ? 'Giao dịch thử nghiệm từ Comey Simulator'
          : 'Biến động số dư tiền vào đã xác thực DKIM',
        color: tx.isTest ? 0xd97706 : 0x0d6e4f,
        fields,
        footer: { text: 'Comey Pay Cloud · Zero-Fee Webhook' },
        timestamp: tx.occurredAt,
      },
    ],
  };
}

export interface GoogleSheetsRowPayload {
  date: string;
  bank: string;
  bankCode: string;
  accountNumber: string;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  content: string;
  senderName: string;
  senderBank: string;
  txId: string;
  isTest: boolean;
  secret?: string;
}

/**
 * Format a UnifiedTransaction into a flat spreadsheet-ready JSON row for Google Sheets Apps Script.
 */
export function formatGoogleSheetsRowPayload(
  tx: UnifiedTransaction,
  secret?: string
): GoogleSheetsRowPayload {
  return {
    date: formatVnDateTimeString(tx.occurredAt),
    bank: resolveGatewayName(tx.bankCode),
    bankCode: tx.bankCode,
    accountNumber: tx.accountNumber,
    direction: tx.direction,
    amount: tx.amount,
    currency: tx.currency,
    content: tx.content,
    senderName: tx.senderName ?? '',
    senderBank: tx.senderBank ?? '',
    txId: tx.txId,
    isTest: tx.isTest,
    ...(secret ? { secret } : {}),
  };
}
