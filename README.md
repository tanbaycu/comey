# Comey — Open-Core Email Payment Verification Bridge

**Comey** biến email thông báo biến động số dư ngân hàng thành **Webhook ký HMAC-SHA256 thời gian thực**, **SePay / PayOS drop-in webhook**, **Telegram / Discord / Google Sheets thông báo tức thì**, **VietQR EMVCo in-memory (`GET /qr`)**, **Hosted Checkout `/p/:shortId`**, và **Loa thu ngân + POS Mini 2-in-1 (ESP32 + Web Speech)** — vận hành tối giản (Zero-KYC, không CCCD/SĐT, không mật khẩu ngân hàng) trên **Cloudflare Workers + D1**.

---

## 1. Cấu trúc Monorepo

```text
comey/
├── packages/
│   ├── core/          # @comey/core — Pure Web Standards TS (12 ngân hàng VN, VietQR, Parser, Crypto, RBAC Scopes)
│   └── apps-script/   # @comey/apps-script — Sinh mã Google Apps Script Cloud Bridge & Standalone
├── apps/
│   ├── cloud/         # @comey/cloud — Cloudflare Workers + Hono + D1 (5 migrations) + Email Worker + Cron + Checkout/POS SSR
│   └── dashboard/     # @comey/dashboard — React 19 + Vite + Tailwind v4 + Studio UI v4 (build -> apps/cloud/public)
├── docs/
│   ├── INTEGRATION.md        # Hợp đồng Webhook, HMAC verify, API & viết BankParser mới
│   └── DEPLOY_CLOUDFLARE.md  # Hướng dẫn deploy lên Cloudflare Free Tier + Email Routing
└── scripts/
    └── dev.mjs        # Khởi động đồng bộ build lõi, D1 migration local, Vite HMR (5173) & Wrangler (8787)
```

---

## 2. Tính năng nổi bật

- **Hỗ trợ 12 ngân hàng Việt Nam (kèm bộ logo chính thức):** Cake by VPBank, MB Bank, Vietcombank, Techcombank, Timo by BVBank, ACB, Sacombank, TPBank, VIB, VPBank, BIDV, VietinBank.
- **2 kênh thu thập email không xin quyền đọc toàn Gmail:**
  - **Auto-Forward (Cloudflare Email Workers):** Filter Gmail chuyển tiếp đúng email ngân hàng tới `in_<bank>_xxx@in.<domain>`, tự bắt mã/link xác nhận Gmail Forwarding.
  - **Google Apps Script Bridge / Standalone:** Sinh sẵn file `.gs` có kiểm tra `Authentication-Results` (`DKIM=pass`), chống trùng Gmail thread (`PROCESSED_MSG_IDS`), `LockService` và `doPost()`.
- **Zero-KYC Automation Pack & POS:**
  - **Định tuyến đa kênh 1 chạm:** Comey HMAC-SHA256, SePay Drop-in, PayOS Drop-in, Telegram Bot, Discord Embed và Google Sheets.
  - **Dynamic `GET /qr`:** Sinh trực tiếp ảnh VietQR PNG/SVG trên edge không cần DB.
  - **Loa thu ngân & POS Mini 2-in-1 (`/soundbox/...`):** Đọc giọng nói tiếng Việt trên trình duyệt/Kiosk và JSON polling cho phần cứng ESP32.
- **API Manager & Bảo mật Edge (Hardened):**
  - **RBAC API Keys (`cm_live_` / `cm_test_`):** Phân quyền theo 14 scope, giới hạn RPM riêng từng key, IP Allowlist (CIDR), hạn sử dụng, xoay key, tạm khóa/thu hồi, nhật ký request telemetry và Playground + OpenAPI 3.1 (`/v1/openapi.json`).
  - **Anti-Spoofing & Hardening:** Strict DKIM/ARC alignment + Hộp cách ly 72 giờ, CSRF Origin Guard, SSRF URL/IPv6/redirect guard, ReDoS protection, PBKDF2 100k password hash + Cookie HttpOnly, Cron retry 60s → 2p → 5p → 15p → 1h.
- **Comey Studio UI v4 (Deploy-First, Zero-Sidebar):**
  - Bố cục Sticky Top-Bar + thanh tab ngang 9 mục, hộp thoại nổi căn giữa (`StudioModal`), bảng lệnh `⌘K`, và **Triển khai & API** (`DeployControlDeck` đo `/health` thời gian thực + `TerminalCodeKit` sinh live CLI, `wrangler.jsonc`, Secrets và Email Routing).

---

## 3. Chạy phát triển & Kiểm định cục bộ

Yêu cầu: Node `>= 22` và `pnpm >= 10`.

```powershell
# 1. Cài đặt dependencies toàn monorepo
pnpm install

# 2. Chạy toàn bộ build (core, apps-script, dashboard -> apps/cloud/public, wrangler dry-run)
pnpm build

# 3. Kiểm tra TypeScript & chạy toàn bộ unit + E2E test suite
pnpm typecheck
pnpm test

# 4. Chạy full-stack local (tự tạo .dev.vars, migrate D1 local, bật Vite :5173 + Wrangler :8787)
pnpm dev
```

Mở `http://127.0.0.1:8787/` để sử dụng giao diện tích hợp API + D1 cục bộ, hoặc `http://127.0.0.1:5173/` khi phát triển UI với HMR.

---

## 4. Tài liệu chi tiết

- Tích hợp Webhook, API, Polling & viết thêm BankParser: [`docs/INTEGRATION.md`](./docs/INTEGRATION.md)
- Deploy lên Cloudflare Workers Free Tier + Email Routing: [`docs/DEPLOY_CLOUDFLARE.md`](./docs/DEPLOY_CLOUDFLARE.md)
