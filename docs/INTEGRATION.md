# Hướng dẫn Tích hợp Comey (Developer Integration Guide)

Comey hỗ trợ 3 cách tích hợp tùy quy mô hệ thống của bạn:
1. **Nhận Webhook tự động** (`X-Comey-Signature`) — phù hợp Web, SaaS, Bot chạy trên server có domain.
2. **Polling API** (`GET /v1/transactions`) — phù hợp Bot chạy localhost / desktop không mở port public.
3. **Nhúng trực tiếp thư viện `@comey/core`** — tự host hoàn toàn trong code TypeScript/Node/Bun/Workers của bạn.

---

## 1. Xác thực bằng API Key

Tạo API Key tại mục **API Keys & Tài liệu** trên Dashboard (`cm_live_...` hoặc `cm_test_...`), gửi kèm vào mọi request API:

```http
Authorization: Bearer cm_live_xxxxxxxxxxxx
```

---

## 2. Hợp đồng Webhook & Xác thực chữ ký `X-Comey-Signature`

Mỗi Webhook POST gửi từ Comey luôn đính kèm các header:
- `Content-Type: application/json`
- `X-Comey-Signature: t=1700000000,v1=<hex_hmac_sha256>`
- `X-Comey-Event-Id: evt_...`
- `X-Comey-Event-Type: transaction.received | session.paid | session.underpaid | session.overpaid_review | session.expired | session.late_payment`

Chuỗi cần ký là `${timestamp}.${rawBody}` bằng **Webhook Secret** (`whsec_...`) sử dụng **HMAC-SHA256**. Luôn kiểm tra độ lệch thời gian `|now - t| <= 300` giây để chống replay attack và so sánh hằng thời gian (`timingSafeEqual`).

### Ví dụ Node.js / Express
```js
import crypto from 'node:crypto';
import express from 'express';

const app = express();

function verifyComeySignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(
    String(sigHeader || '').split(',').map((p) => p.trim().split('='))
  );
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(parts.v1, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/webhooks/comey', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const sig = req.header('X-Comey-Signature');
  if (!verifyComeySignature(rawBody, sig, process.env.COMEY_WEBHOOK_SECRET)) {
    return res.status(401).json({ ok: false });
  }

  const event = JSON.parse(rawBody);
  // Idempotency: lưu event.id (hoặc event.data.transaction.id) trước khi cộng tiền/duyệt đơn
  console.log(event.type, event.data);
  res.json({ ok: true });
});
```

### Ví dụ Payload `session.paid`
```json
{
  "id": "evt_7a91c0...",
  "type": "session.paid",
  "createdAt": "2026-11-26T09:15:05.000Z",
  "isTest": false,
  "data": {
    "session": {
      "id": "sess_...",
      "shortId": "4Km9Xp2Lq8Zr",
      "orderCode": "SHOP100200",
      "expectedAmount": 80000,
      "receivedAmount": 80000,
      "status": "paid",
      "overpaid": false,
      "excessAmount": 0
    },
    "transaction": {
      "id": "tx_...",
      "bankCode": "CAKE",
      "bankTxId": "FT26330123456789",
      "amount": 80000,
      "content": "SHOP 100200",
      "auth": { "status": "verified", "dkimDomain": "cake.vn" }
    }
  }
}
```

---

## 3. Tạo Phiên Thanh Toán Lớp 2 & Hosted Checkout

```bash
curl -X POST https://your-comey-domain.com/v1/sessions \
  -H "Authorization: Bearer cm_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "bankAccountId": "ba_...",
    "orderCode": "SHOP100200",
    "amount": 80000,
    "ttlSeconds": 600,
    "exactMatchOnly": false,
    "returnUrl": "https://shop.vn/orders/SHOP100200"
  }'
```

Response trả về sẵn:
- `checkoutUrl`: `https://your-comey-domain.com/p/<shortId>` (trang QR mobile-first tự đếm ngược & tự poll).
- `qrPngUrl`: `https://your-comey-domain.com/p/<shortId>/qr.png` (ảnh PNG gửi thẳng vào Bot Telegram/Zalo).
- `vietqr.emvco` và `vietqr.svg`: chuỗi EMVCo NAPAS 247 + vector SVG nhúng thẳng vào UI.

---

## 4. Polling API (Cho App Localhost)

```http
GET /v1/transactions?orderCode=SHOP100200&includeTest=false
Authorization: Bearer cm_live_...
```

---

## 5. Cách thêm `BankEmailParser` cho ngân hàng mới trong `@comey/core`

Mỗi ngân hàng là một plugin độc lập triển khai interface `BankEmailParser`:

1. Lấy mẫu email biến động số dư thật (`.eml` hoặc HTML + plain-text), ẩn thông tin nhạy cảm cá nhân và lưu vào `packages/core/tests/fixtures/`.
2. Tạo file parser mới tại `packages/core/src/parsers/<bank>.ts` triển khai:
   - `bank`: metadata từ `BANK_CATALOG` (`packages/core/src/banks/catalog.ts`, nhớ kiểm tra kỹ `dkimDomains` thật trong header `Authentication-Results`).
   - `canHandle(email)`: khớp domain gửi thư của ngân hàng.
   - `parse(email, expectedAccountNo?)`: bóc tách `amount`, `txId`, `accountNumber`, `direction` (`'in'` / `'out'`), `content`, `occurredAt`.
3. Đăng ký parser vào `createDefaultParserRegistry()` trong `packages/core/src/parsers/registry.ts`.
4. Viết unit test bằng Vitest với cả email tiền vào, tiền ra, template lỗi (đẩy Quarantine) và email giả mạo DKIM, rồi chạy `pnpm test`.
