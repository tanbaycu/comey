export type SnippetLanguage = 'node' | 'telegram' | 'php' | 'python';

export function buildIntegrationSnippet(lang: SnippetLanguage, baseUrl: string): string {
  const origin = String(baseUrl || 'https://pay.comey.dev').replace(/\/$/, '');

  if (lang === 'node') {
    return `import crypto from 'node:crypto';
import express from 'express';

const app = express();

function verifyComeySignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(
    String(sigHeader || '')
      .split(',')
      .map((p) => p.trim().split('='))
      .filter(([k, v]) => k && v)
  );
  if (!parts.t || !parts.v1) return false;
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest('hex');

  const sigBuf = Buffer.from(parts.v1, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// 1) Tạo link thanh toán QR cho đơn hàng
async function createCheckout(orderCode, amount) {
  const resp = await fetch('${origin}/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: \`Bearer \${process.env.COMEY_API_KEY}\`,
    },
    body: JSON.stringify({
      bankAccountId: process.env.COMEY_BANK_ACCOUNT_ID,
      orderCode,
      amount,
    }),
  });
  return resp.json(); // { checkoutUrl, qrPngUrl, vietqr }
}

// 2) Nhận Webhook xác nhận tự động
app.post('/webhooks/comey', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const sig = req.header('X-Comey-Signature');
  if (!verifyComeySignature(rawBody, sig, process.env.COMEY_WEBHOOK_SECRET)) {
    return res.status(401).json({ ok: false });
  }

  const event = JSON.parse(rawBody);
  if (event.type === 'session.paid' || event.type === 'transaction.received') {
    console.log('Tiền vào:', event.data);
    // TODO: Idempotent check bằng event.data.transaction.id -> duyệt đơn
  }
  res.json({ ok: true });
});`;
  }

  if (lang === 'telegram') {
    return `import { Bot, InlineKeyboard } from 'grammy';

const bot = new Bot(process.env.BOT_TOKEN);

bot.command('nap', async (ctx) => {
  const orderCode = \`NAP\${ctx.from.id.toString().slice(-4)}\${Date.now().toString().slice(-4)}\`;
  const resp = await fetch('${origin}/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: \`Bearer \${process.env.COMEY_API_KEY}\`,
    },
    body: JSON.stringify({
      bankAccountId: process.env.COMEY_BANK_ACCOUNT_ID,
      orderCode,
      amount: 50000,
      ttlSeconds: 600,
    }),
  });
  const data = await resp.json();

  await ctx.replyWithPhoto(data.qrPngUrl, {
    caption: \`Quét QR chuyển khoản <b>50.000đ</b>\\nNội dung: <code>\${orderCode}</code>\`,
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().url('Mở cổng thanh toán', data.checkoutUrl),
  });
});`;
  }

  if (lang === 'php') {
    return `<?php
// Nhận Webhook Comey trong PHP / Laravel
$rawBody = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_X_COMEY_SIGNATURE'] ?? '';
$secret = getenv('COMEY_WEBHOOK_SECRET');

parse_str(str_replace(',', '&', $sigHeader), $parts);
$t = $parts['t'] ?? null;
$v1 = $parts['v1'] ?? null;
if (!is_string($t) || !is_string($v1) || !ctype_digit($t) || abs(time() - (int)$t) > 300) {
    http_response_code(401);
    exit('Invalid timestamp');
}

$expected = hash_hmac('sha256', $t . '.' . $rawBody, $secret);
if (!hash_equals($expected, $v1)) {
    http_response_code(401);
    exit('Invalid signature');
}

$event = json_decode($rawBody, true);
if (($event['type'] ?? '') === 'session.paid') {
    $orderCode = $event['data']['session']['orderCode'];
    $amount = $event['data']['session']['receivedAmount'];
    // TODO: Cập nhật đơn hàng $orderCode đã thanh toán $amount
}

header('Content-Type: application/json');
echo json_encode(['ok' => true]);`;
  }

  return `import hmac
import hashlib
import time
import requests
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

def verify_comey_signature(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(item.strip().split("=", 1) for item in header.split(",") if "=" in item)
    ts, sig = parts.get("t"), parts.get("v1")
    if not ts or not sig:
        return False
    try:
        ts_int = int(ts)
    except (TypeError, ValueError):
        return False
    if abs(int(time.time()) - ts_int) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)

# Cách 1: Nhận Webhook (Production)
@app.post("/webhooks/comey")
async def comey_webhook(request: Request):
    raw_body = await request.body()
    sig = request.headers.get("X-Comey-Signature", "")
    if not verify_comey_signature(raw_body, sig, "YOUR_WEBHOOK_SECRET"):
        raise HTTPException(status_code=401, detail="Invalid signature")
    event = await request.json()
    return {"ok": True, "type": event["type"]}

# Cách 2: Polling API (Cho bot chạy localhost không mở port)
def poll_transactions(api_key: str, order_code: str):
    r = requests.get(
        "${origin}/v1/transactions",
        params={"orderCode": order_code},
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10,
    )
    return r.json()["transactions"]`;
}
