import {
  createVietQR,
  decryptSecret,
  expireSessionIfPastDeadline,
  generateQrPngBytes,
  generateVietQREMVCo,
  getBankMetadata,
  randomBase64Url,
} from '@comey/core';
import { Hono } from 'hono';
import {
  rowToPaymentSession,
  type BankAccountRow,
  type PaymentSessionRow,
} from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { checkLocalRateLimit, checkRateLimit, getClientIp } from '../middleware/rateLimit.js';
import { validateAppsScriptUrl, validateSafeOutboundUrl } from '../security/urlGuard.js';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} đ`;
}

function sanitizeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  const check = validateSafeOutboundUrl(raw);
  if (!check.ok) return null;
  try {
    const parsed = new URL(check.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function renderNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<title>Liên kết thanh toán không khả dụng</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F6F7F5;color:#121417;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{max-width:390px;width:100%;background:#fff;border:1px solid rgba(18,20,23,.10);border-radius:20px;padding:28px 22px;text-align:center}
  h1{font-size:19px;font-weight:800;margin-bottom:8px}
  p{font-size:14px;color:#525866;line-height:1.55}
</style>
</head>
<body>
  <main class="card">
    <h1>Phiên thanh toán không tồn tại</h1>
    <p>Liên kết không hợp lệ hoặc đã bị xóa. Vui lòng tạo đơn mới từ ứng dụng.</p>
  </main>
</body>
</html>`;
}

function renderCheckoutHtml(row: PaymentSessionRow, qrSvg: string, nonce: string): string {
  const bankMeta = getBankMetadata(row.bank_code);
  const bankName = escapeHtml(bankMeta?.name || row.bank_code);
  const bankColor = escapeHtml(bankMeta?.color || '#0D6E4F');
  const orderCode = escapeHtml(row.order_code);
  const accNumber = escapeHtml(row.account_number);
  const accName = escapeHtml(row.account_name);
  const shortId = escapeHtml(row.short_id);
  const amountFormatted = escapeHtml(formatVnd(row.expected_amount));
  const validatedReturnUrl = sanitizeReturnUrl(row.return_url);
  const safeReturnUrl = validatedReturnUrl ? escapeHtml(validatedReturnUrl) : '';
  const initialState = safeJsonForScript({
    shortId: row.short_id,
    status: row.status,
    expectedAmount: row.expected_amount,
    receivedAmount: row.received_amount,
    missingAmount: row.missing_amount,
    overpaid: row.overpaid === 1,
    excessAmount: row.excess_amount,
    expiresAt: row.expires_at,
    returnUrl: validatedReturnUrl,
  });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<title>Thanh toán ${orderCode} — ${amountFormatted}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  :focus-visible{outline:2px solid #047857;outline-offset:2px}
  body{background:#FAFAFA;color:#09090B;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;justify-content:center;padding:20px 14px 40px;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:420px}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
  .step{background:#fff;border:1px solid rgba(9,9,11,.08);border-radius:8px;padding:7px 8px;text-align:center;font-size:11.5px;font-weight:600;color:#71717A}
  .step.active{background:#09090B;color:#fff;border-color:#09090B}
  .step.done{background:#ECFDF5;color:#047857;border-color:#A7F3D0}
  .ticket{border-radius:14px;overflow:hidden;border:1px solid rgba(9,9,11,.08);box-shadow:0 10px 30px -16px rgba(9,9,11,.12);background:#fff}
  .top{background:#09090B;color:#fff;padding:20px 20px 26px;text-align:center}
  .brand-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  .bank-pill{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.12);color:#FAFAFA;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600}
  .dot{width:7px;height:7px;border-radius:999px;background:${bankColor}}
  .timer{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.12);color:#FAFAFA;padding:4px 10px;border-radius:6px}
  .amount{font-size:28px;font-weight:700;letter-spacing:-.025em;margin-bottom:16px;font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .qr-box{background:#fff;border-radius:10px;padding:12px;display:inline-block;width:216px;height:216px;border:1px solid rgba(255,255,255,.15)}
  .qr-box svg{width:100%;height:100%;display:block}
  .bottom{background:#fff;padding:18px 18px 20px}
  .status-banner{padding:10px 12px;border-radius:8px;border:1px solid rgba(9,9,11,.08);font-size:13px;font-weight:500;margin-bottom:14px;background:#FAFAFA;color:#09090B;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px}
  .status-banner.paid{background:#ECFDF5;color:#047857;border-color:#A7F3D0}
  .status-banner.underpaid{background:#FFFBEB;color:#92400E;border-color:#FDE68A}
  .status-banner.error{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}
  .pulse-dot{width:7px;height:7px;border-radius:50%;background:#047857;flex-shrink:0;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.85)}}
  .field{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#FAFAFA;border:1px solid rgba(9,9,11,.08);border-radius:8px;padding:10px 12px;margin-bottom:8px}
  .field-label{font-size:11.5px;color:#71717A;font-weight:500;margin-bottom:2px}
  .field-val{font-size:14px;font-weight:600;color:#09090B;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
  .copy-btn{border:1px solid rgba(9,9,11,.12);background:#fff;color:#09090B;border-radius:6px;min-height:32px;padding:0 11px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;transition:transform 140ms cubic-bezier(.23,1,.32,1),background-color 140ms ease,border-color 140ms ease}
  .copy-btn:hover{background:#F4F4F5}
  .copy-btn:active{transform:scale(.97)}
  .copy-btn.copied{background:#047857;color:#fff;border-color:#047857}
  .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
  .btn{display:flex;align-items:center;justify-content:center;min-height:42px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:transform 140ms cubic-bezier(.23,1,.32,1),background-color 140ms ease}
  .btn:active:not(:disabled){transform:scale(.97)}
  .btn-primary{background:#047857;color:#fff}
  .btn-primary:hover:not(:disabled){background:#065F46}
  .btn-primary:disabled{opacity:.5;cursor:not-allowed}
  .btn-secondary{background:#fff;color:#09090B;border:1px solid rgba(9,9,11,.13)}
  .btn-secondary:hover{background:#F4F4F5}
  .return-btn{display:none;margin-top:10px;width:100%;background:#09090B;color:#fff}
  .foot{text-align:center;font-size:11.5px;color:#71717A;margin-top:14px}
  @media (prefers-reduced-motion:reduce){.pulse-dot,.btn,.copy-btn{animation:none;transition:none}}
</style>
</head>
<body>
  <main class="wrap">
    <div class="steps" aria-label="Tiến trình thanh toán">
      <div class="step done" id="step1">1. Quét mã QR</div>
      <div class="step active" id="step2">2. Chuyển đúng mã</div>
      <div class="step" id="step3">3. Tự động duyệt</div>
    </div>
    <div class="ticket">
      <section class="top">
        <div class="brand-row">
          <span class="bank-pill"><span class="dot"></span>${bankName}</span>
          <span class="timer" id="timer">--:--</span>
        </div>
        <div class="amount">${amountFormatted}</div>
        <div class="qr-box">${qrSvg}</div>
      </section>
      <section class="bottom">
        <div class="status-banner" id="statusBanner">
          <span class="pulse-dot" id="pulseDot"></span>
          <span id="statusText">Đang chờ chuyển khoản tự động...</span>
        </div>
        <div class="field">
          <div>
            <div class="field-label">Chủ tài khoản</div>
            <div class="field-val">${accName}</div>
          </div>
        </div>
        <div class="field">
          <div>
            <div class="field-label">Số tài khoản</div>
            <div class="field-val" id="valAcc">${accNumber}</div>
          </div>
          <button class="copy-btn" data-copy="${accNumber}">Sao chép</button>
        </div>
        <div class="field">
          <div>
            <div class="field-label">Số tiền chính xác</div>
            <div class="field-val">${amountFormatted}</div>
          </div>
          <button class="copy-btn" data-copy="${row.expected_amount}">Sao chép</button>
        </div>
        <div class="field">
          <div>
            <div class="field-label">Nội dung chuyển khoản (bắt buộc)</div>
            <div class="field-val">${orderCode}</div>
          </div>
          <button class="copy-btn" data-copy="${orderCode}">Sao chép</button>
        </div>
        <div class="actions">
          <a class="btn btn-secondary" href="/p/${shortId}/qr.png" download="vietqr-${orderCode}.png">Tải ảnh QR</a>
          <button class="btn btn-primary" id="checkBtn">Tôi đã chuyển xong</button>
        </div>
        ${safeReturnUrl ? `<a class="btn return-btn" id="returnBtn" href="${safeReturnUrl}" rel="noopener noreferrer">Quay lại ứng dụng</a>` : ''}
      </section>
    </div>
    <div class="foot">Đối soát tự động qua Comey với xác thực DKIM ngân hàng</div>
  </main>
<script nonce="${nonce}">
(function(){
  var state = ${initialState};
  var banner = document.getElementById('statusBanner');
  var statusText = document.getElementById('statusText');
  var pulseDot = document.getElementById('pulseDot');
  var timerEl = document.getElementById('timer');
  var checkBtn = document.getElementById('checkBtn');
  var returnBtn = document.getElementById('returnBtn');
  var step2 = document.getElementById('step2');
  var step3 = document.getElementById('step3');

  function renderStatus(s){
    state = Object.assign({}, state, s);
    banner.className = 'status-banner';
    if (state.status === 'paid') {
      banner.classList.add('paid');
      pulseDot.style.display = 'none';
      step2.className = 'step done';
      step3.className = 'step done';
      statusText.textContent = state.overpaid
        ? 'Thanh toán thành công (nhận dư ' + state.excessAmount.toLocaleString('vi-VN') + ' đ).'
        : 'Thanh toán thành công! Đã xác nhận tự động.';
      if (returnBtn) returnBtn.style.display = 'flex';
      checkBtn.disabled = true;
    } else if (state.status === 'underpaid') {
      banner.classList.add('underpaid');
      pulseDot.style.display = 'none';
      statusText.textContent = 'Chuyển thiếu ' + state.missingAmount.toLocaleString('vi-VN') + ' đ. Vui lòng liên hệ hỗ trợ.';
    } else if (state.status === 'overpaid_review') {
      banner.classList.add('underpaid');
      pulseDot.style.display = 'none';
      statusText.textContent = 'Số tiền chuyển dư đang chờ shop xác nhận.';
    } else if (state.status === 'expired') {
      banner.classList.add('error');
      pulseDot.style.display = 'none';
      statusText.textContent = 'Phiên thanh toán đã hết hạn.';
      checkBtn.disabled = true;
    } else if (state.status === 'cancelled') {
      banner.classList.add('error');
      pulseDot.style.display = 'none';
      statusText.textContent = 'Phiên thanh toán đã bị hủy.';
      checkBtn.disabled = true;
    } else {
      pulseDot.style.display = 'inline-block';
      statusText.textContent = 'Đang chờ chuyển khoản tự động...';
    }
  }

  function updateTimer(){
    if (state.status === 'paid' || state.status === 'cancelled' || state.status === 'expired') {
      timerEl.textContent = state.status === 'paid' ? 'PAID' : 'ENDED';
      return;
    }
    var diff = Math.max(0, Math.floor((Date.parse(state.expiresAt) - Date.now()) / 1000));
    var m = String(Math.floor(diff / 60)).padStart(2, '0');
    var s = String(diff % 60).padStart(2, '0');
    timerEl.textContent = m + ':' + s;
    if (diff === 0 && state.status === 'pending') {
      renderStatus({ status: 'expired' });
    }
  }

  document.querySelectorAll('.copy-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var val = btn.getAttribute('data-copy') || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(function(){
          btn.classList.add('copied');
          btn.textContent = '✓ Đã chép';
          setTimeout(function(){
            btn.classList.remove('copied');
            btn.textContent = 'Chép';
          }, 1600);
        });
      }
    });
  });

  function pollStatus(){
    if (state.status === 'paid' || state.status === 'expired' || state.status === 'cancelled') return;
    fetch('/api/checkout/' + encodeURIComponent(state.shortId) + '/status')
      .then(function(r){ return r.json(); })
      .then(function(data){ if (data && data.ok) renderStatus(data.session); })
      .catch(function(){});
  }

  checkBtn.addEventListener('click', function(){
    checkBtn.disabled = true;
    checkBtn.textContent = 'Đang kiểm tra...';
    fetch('/api/checkout/' + encodeURIComponent(state.shortId) + '/check', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data && data.session) renderStatus(data.session);
        if (data && data.error) statusText.textContent = data.error;
      })
      .catch(function(){})
      .finally(function(){
        if (state.status !== 'paid' && state.status !== 'expired' && state.status !== 'cancelled') {
          checkBtn.disabled = false;
        }
        checkBtn.textContent = 'Tôi đã chuyển xong';
      });
  });

  renderStatus(state);
  updateTimer();
  setInterval(updateTimer, 1000);
  setInterval(pollStatus, 3000);
})();
</script>
</body>
</html>`;
}

async function resolveSessionWithExpiry(
  db: D1Database,
  shortId: string
): Promise<PaymentSessionRow | null> {
  const row = await db
    .prepare(`SELECT * FROM payment_sessions WHERE short_id = ?`)
    .bind(shortId)
    .first<PaymentSessionRow>();
  if (!row) return null;

  const check = expireSessionIfPastDeadline(rowToPaymentSession(row));
  if (check.expired) {
    await db
      .prepare(
        `UPDATE payment_sessions SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending', 'underpaid')`
      )
      .bind(check.session.updatedAt, row.id)
      .run();
    return {
      ...row,
      status: 'expired',
      updated_at: check.session.updatedAt,
    };
  }
  return row;
}

export function createCheckoutRoutes(options?: {
  appsScriptFetch?: typeof fetch;
}): {
  portal: Hono<AppContextEnv>;
  api: Hono<AppContextEnv>;
} {
  const portal = new Hono<AppContextEnv>();

  portal.get('/:shortId', async (c) => {
    const pageRl = checkLocalRateLimit(c.env.DB, `checkout_page:${getClientIp(c)}`, 120, 60_000);
    if (!pageRl.allowed) {
      c.header('Retry-After', String(pageRl.retryAfterSeconds));
      return c.text('Too many requests', 429);
    }

    const shortId = c.req.param('shortId');
    const row = await resolveSessionWithExpiry(c.env.DB, shortId);
    c.header('Cache-Control', 'no-store');

    if (!row) {
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
      );
      return c.html(renderNotFoundHtml(), 404);
    }

    const nonce = randomBase64Url(16);
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`
    );

    const qr = createVietQR({
      bankBin: row.bank_bin,
      accountNumber: row.account_number,
      amount: row.expected_amount,
      transferNote: row.order_code,
    });
    return c.html(renderCheckoutHtml(row, qr.svg, nonce));
  });

  portal.get('/:shortId/qr.png', async (c) => {
    const ip = getClientIp(c);
    const rl = await checkRateLimit(c.env.DB, `qr_png:${ip}`, 60, 60);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json({ ok: false, error: 'Too many QR requests' }, 429);
    }

    const shortId = c.req.param('shortId');
    try {
      const edgeCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
      if (edgeCache) {
        const cached = await edgeCache.match(c.req.url);
        if (cached) {
          return cached;
        }
      }
    } catch {
      // Ignore Cache API errors in non-edge runtimes
    }

    const row = await resolveSessionWithExpiry(c.env.DB, shortId);
    if (!row) {
      return c.json({ ok: false, error: 'Payment session not found' }, 404);
    }
    const emvco = generateVietQREMVCo({
      bankBin: row.bank_bin,
      accountNumber: row.account_number,
      amount: row.expected_amount,
      transferNote: row.order_code,
    });
    const pngBytes = generateQrPngBytes(emvco);
    const pngBuf = new Uint8Array(pngBytes.byteLength);
    pngBuf.set(pngBytes);

    try {
      const edgeCache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
      if (edgeCache) {
        const cacheCopy = new Response(pngBuf.slice().buffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
          },
        });
        const putPromise = edgeCache.put(c.req.url, cacheCopy).catch(() => {});
        try {
          c.executionCtx.waitUntil(putPromise);
        } catch {
          await putPromise;
        }
      }
    } catch {
      // Ignore Cache API errors in non-edge runtimes
    }

    return new Response(pngBuf.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  const api = new Hono<AppContextEnv>();

  api.get('/:shortId/status', async (c) => {
    const shortId = c.req.param('shortId');
    const row = await resolveSessionWithExpiry(c.env.DB, shortId);
    if (!row) {
      return c.json({ ok: false, error: 'Payment session not found' }, 404);
    }
    return c.json({
      ok: true,
      session: {
        shortId: row.short_id,
        orderCode: row.order_code,
        status: row.status,
        expectedAmount: row.expected_amount,
        receivedAmount: row.received_amount,
        missingAmount: row.missing_amount,
        overpaid: row.overpaid === 1,
        excessAmount: row.excess_amount,
        expiresAt: row.expires_at,
        paidAt: row.paid_at,
        returnUrl: sanitizeReturnUrl(row.return_url),
      },
    });
  });

  api.post('/:shortId/check', async (c) => {
    const shortId = c.req.param('shortId');
    let row = await resolveSessionWithExpiry(c.env.DB, shortId);
    if (!row) {
      return c.json({ ok: false, error: 'Payment session not found' }, 404);
    }

    const rl = await checkRateLimit(c.env.DB, `checkout_check:${shortId}`, 1, 5);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSeconds));
      return c.json(
        {
          ok: false,
          error: `Vui lòng đợi ${rl.retryAfterSeconds}s trước khi kiểm tra lại.`,
          retryAfterSeconds: rl.retryAfterSeconds,
          session: {
            shortId: row.short_id,
            orderCode: row.order_code,
            status: row.status,
            expectedAmount: row.expected_amount,
            receivedAmount: row.received_amount,
            missingAmount: row.missing_amount,
            overpaid: row.overpaid === 1,
            excessAmount: row.excess_amount,
            expiresAt: row.expires_at,
            paidAt: row.paid_at,
            returnUrl: sanitizeReturnUrl(row.return_url),
          },
        },
        429
      );
    }

    let triggeredOnDemand = false;
    if (row.status === 'pending' || row.status === 'underpaid') {
      const account = await c.env.DB.prepare(
        `SELECT apps_script_url, apps_script_secret_enc FROM bank_accounts WHERE id = ?`
      )
        .bind(row.bank_account_id)
        .first<Pick<BankAccountRow, 'apps_script_url' | 'apps_script_secret_enc'>>();

      if (
        account?.apps_script_url &&
        account.apps_script_secret_enc &&
        validateAppsScriptUrl(account.apps_script_url).ok
      ) {
        try {
          const secret = await decryptSecret(
            account.apps_script_secret_enc,
            c.env.MASTER_ENCRYPTION_KEY
          );
          const fetchFn = options?.appsScriptFetch ?? globalThis.fetch;
          // MED-3: Use redirect: 'manual' so secret is never forwarded to arbitrary redirect hosts.
          // Only follow a single GET redirect to https://script.googleusercontent.com/...
          const resp = await fetchFn(account.apps_script_url, {
            method: 'POST',
            redirect: 'manual',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, source: 'checkout_check' }),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.status >= 300 && resp.status < 400) {
            const loc = resp.headers.get('location');
            if (loc) {
              const target = new URL(loc, account.apps_script_url);
              if (
                target.protocol === 'https:' &&
                target.hostname.toLowerCase() === 'script.googleusercontent.com' &&
                target.port === ''
              ) {
                await fetchFn(target.toString(), {
                  method: 'GET',
                  redirect: 'manual',
                  signal: AbortSignal.timeout(5000),
                });
                triggeredOnDemand = true;
              } else {
                triggeredOnDemand = false;
              }
            } else {
              triggeredOnDemand = false;
            }
          } else {
            triggeredOnDemand = resp.ok;
          }
          if (triggeredOnDemand) {
            row = (await resolveSessionWithExpiry(c.env.DB, shortId)) ?? row;
          }
        } catch {
          triggeredOnDemand = false;
        }
      }
    }

    return c.json({
      ok: true,
      triggeredOnDemand,
      session: {
        shortId: row.short_id,
        orderCode: row.order_code,
        status: row.status,
        expectedAmount: row.expected_amount,
        receivedAmount: row.received_amount,
        missingAmount: row.missing_amount,
        overpaid: row.overpaid === 1,
        excessAmount: row.excess_amount,
        expiresAt: row.expires_at,
        paidAt: row.paid_at,
        returnUrl: sanitizeReturnUrl(row.return_url),
      },
    });
  });

  return { portal, api };
}
