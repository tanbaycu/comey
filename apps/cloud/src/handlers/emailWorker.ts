import type { BankAccountRow } from '../db/types.js';
import type { Env } from '../env.js';
import { ingestRawEmailForAccount, type IngestResult } from '../services/ingest.js';

const MAX_RAW_EMAIL_BYTES = 2 * 1024 * 1024; // 2 MB cap prevents Worker OOM

export async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes = MAX_RAW_EMAIL_BYTES
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('Email payload exceeds 2MB limit').catch(() => {});
      throw new Error(`Email exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface InboundEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

export async function handleInboundEmail(
  message: InboundEmailMessage,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  options?: { syncWebhooks?: boolean; fetchImpl?: typeof fetch; nowMs?: number }
): Promise<IngestResult | null> {
  const toAddr = String(message.to || '').trim().toLowerCase();
  const atIdx = toAddr.indexOf('@');
  const alias = (atIdx > 0 ? toAddr.slice(0, atIdx) : toAddr).trim();

  if (!alias) {
    message.setReject('Invalid Comey inbound address');
    return null;
  }

  const account = await env.DB.prepare(
    `SELECT * FROM bank_accounts WHERE inbound_alias = ? AND enabled = 1`
  )
    .bind(alias)
    .first<BankAccountRow>();

  if (!account) {
    message.setReject('Unknown Comey inbound recipient');
    return null;
  }

  // Buffer message.raw ONCE (ReadableStream is single-use)
  let rawBytes: Uint8Array;
  try {
    rawBytes = await readStreamBounded(message.raw);
  } catch (err) {
    message.setReject(err instanceof Error ? err.message : 'Email too large');
    return null;
  }

  const rawMime = new TextDecoder('utf-8').decode(rawBytes);

  return ingestRawEmailForAccount(
    env,
    ctx,
    account,
    {
      source: 'email_worker',
      // Leave `from` empty so processIncomingEmail uses the genuine MIME `From:` header
      // instead of SMTP envelope `message.from` (which breaks Gmail auto-forwarding).
      from: '',
      to: message.to,
      envelopeFrom: message.from,
      rawMime,
    },
    options
  );
}
