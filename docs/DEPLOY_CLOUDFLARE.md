# Hướng dẫn Deploy Comey lên Cloudflare Free Tier (0đ/tháng)

Kiến trúc của `apps/cloud` tương thích **100% gói miễn phí Cloudflare**:
- **Cloudflare Workers** + **Workers Static Assets** (chạy API + Checkout SSR + React Dashboard trên cùng 1 Worker)
- **Cloudflare D1** (SQLite database miễn phí)
- **Cloudflare Email Routing / Email Workers** (nhận Auto-Forward 1–3s, miễn phí)
- **Cron Trigger** (`* * * * *` tự retry webhook lỗi, hết hạn phiên & dọn Quarantine 72h)

---

## Bước 1: Tạo D1 Database và cập nhật `wrangler.jsonc`

```powershell
cd apps/cloud
pnpm exec wrangler login
pnpm exec wrangler d1 create comey-db
```

Copy `database_id` trả về dán thay vào `apps/cloud/wrangler.jsonc` ở mục `d1_databases[0].database_id`, đồng thời sửa `vars`:
- `INBOUND_EMAIL_DOMAIN`: tên miền phụ nhận email (VD: `in.yourdomain.com`)
- `PUBLIC_BASE_URL`: URL Worker/Domain chính thức (VD: `https://pay.yourdomain.com`)
- `ALLOW_PUBLIC_SIGNUP`: `"true"` nếu mở đăng ký công khai, hoặc `"false"` nếu chỉ dùng nội bộ/mời qua `ADMIN_BOOTSTRAP_KEY`.

---

## Bước 2: Chạy Migration D1 Remote & Cài Secrets Bảo Mật

```powershell
# Áp schema SQL lên D1 production
pnpm exec wrangler d1 migrations apply DB --remote

# Đặt khóa bí mật (nhập chuỗi ngẫu nhiên >= 32 ký tự)
pnpm exec wrangler secret put MASTER_ENCRYPTION_KEY
pnpm exec wrangler secret put SESSION_SECRET
# (Tùy chọn nếu tắt ALLOW_PUBLIC_SIGNUP="false")
pnpm exec wrangler secret put ADMIN_BOOTSTRAP_KEY
```

---

## Bước 3: Build toàn bộ & Deploy lên Cloudflare

```powershell
# Tại thư mục gốc comey/
pnpm build
pnpm --filter @comey/cloud exec wrangler deploy
```

Lệnh `pnpm build` sẽ tự build `@comey/core`, `@comey/apps-script`, build React Dashboard vào `apps/cloud/public/`, và đóng gói Worker cùng Static Assets.

---

## Bước 4: Bật Cloudflare Email Routing để nhận Auto-Forward (1–3s)

1. Vào **Cloudflare Dashboard** → chọn Domain của bạn (hoặc subdomain `in.yourdomain.com`) → mục **Email → Email Routing**.
2. Bật Email Routing (Cloudflare sẽ tự thêm các bản ghi MX/TXT DNS cần thiết).
3. Vào tab **Routing rules → Catch-all address**:
   - Đổi trạng thái sang **Active**.
   - Chọn **Action: Send to a Worker** → chọn Worker **`comey-cloud`**.
4. Lưu lại. Từ lúc này, mọi địa chỉ `in_cake_xxx@in.yourdomain.com` mà Comey sinh ra trong Dashboard đều tự động chạy vào `email()` handler của `comey-cloud`!

---

## Kiểm tra nhanh sau Deploy

- Mở `https://pay.yourdomain.com/health` → xác nhận trả về `{"ok": true, "service": "comey-cloud"}`.
- Mở `https://pay.yourdomain.com` → đăng ký tài khoản chủ Workspace đầu tiên, thêm STK Cake, mở **Setup Wizard** để cài Auto-Forward hoặc Google Apps Script và test thử bằng **Webhook Simulator**.
