import {
  createVietQR,
  formatSoundboxSpeech,
  getBankMetadata,
  randomBase64Url,
  randomHex,
  sha256Hex,
  vndToVietnameseWords,
} from '@comey/core';
import { Hono, type Context } from 'hono';
import type { BankAccountRow, SoundboxRow, TransactionRow } from '../db/types.js';
import type { AppContextEnv } from '../env.js';
import { requireLiveAuth, requireScope, requireWorkspaceAuth } from '../middleware/auth.js';
import { checkRateLimit, getClientIp } from '../middleware/rateLimit.js';
import { recordAuditLog } from '../services/audit.js';

const SOUNDBOX_LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
const SOUNDBOX_MAX_LOOKBACK_MS = 24 * 3600 * 1000;
const SOUNDBOX_DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

// PERF-H1: Lightweight isolate-local sliding window for valid soundbox polling (zero D1 writes)
const localPollBuckets = new Map<string, { count: number; resetAt: number }>();

function checkLocalPollLimit(soundboxId: string, maxHits = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  if (localPollBuckets.size > 1000) {
    for (const [k, v] of localPollBuckets) {
      if (v.resetAt <= now) localPollBuckets.delete(k);
    }
  }
  const existing = localPollBuckets.get(soundboxId);
  if (!existing || existing.resetAt <= now) {
    localPollBuckets.set(soundboxId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxHits) {
    return false;
  }
  existing.count++;
  return true;
}

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

function maskToken(token: string): string {
  if (token.length <= 12) return 'sbx_****';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function extractTokenPreview(storedTokenColumn: string): string {
  const hashIdx = storedTokenColumn.indexOf('#');
  if (hashIdx > 0) {
    return storedTokenColumn.slice(0, hashIdx);
  }
  return maskToken(storedTokenColumn);
}

function maskAccountNumber(accountNumber: string): string {
  const digits = String(accountNumber || '').trim();
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

function getBaseOrigin(c: Context<AppContextEnv>): string {
  const configured = c.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return new URL(c.req.url).origin;
}

function buildSoundboxUrls(origin: string, token: string) {
  return {
    kioskUrl: `${origin}/soundbox/${token}`,
    eventsUrl: `${origin}/api/soundbox/${token}/events`,
  };
}

function sanitizeSoundbox(row: SoundboxRow) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    scope: row.scope ?? (row.bank_account_id ? 'account' : 'all'),
    name: row.name,
    tokenPreview: extractTokenPreview(row.kiosk_token),
    voiceLang: row.voice_lang,
    voiceTemplate: row.voice_template,
    minAmount: row.min_amount,
    enabled: row.enabled === 1,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function extractBearerToken(c: Context<AppContextEnv>): string {
  const auth = (c.req.header('authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

async function findSoundboxByToken(
  db: D1Database,
  rawToken: string
): Promise<SoundboxRow | null> {
  const token = String(rawToken || '').trim();
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const byHash = await db
    .prepare(`SELECT * FROM soundboxes WHERE kiosk_token_hash = ?`)
    .bind(tokenHash)
    .first<SoundboxRow>();
  if (byHash) return byHash;

  // Backwards-compat fallback for legacy pre-0004 rows where kiosk_token_hash IS NULL
  return db
    .prepare(`SELECT * FROM soundboxes WHERE kiosk_token_hash IS NULL AND kiosk_token = ?`)
    .bind(token)
    .first<SoundboxRow>();
}

function isSoundboxAuthorizedAndActive(row: SoundboxRow | null): row is SoundboxRow {
  if (!row) return false;
  if (row.enabled !== 1) return false;
  // SEC-H4: Never widen an account-scoped soundbox to all workspace accounts after account deletion
  if (row.scope === 'account' && !row.bank_account_id) return false;
  return true;
}

function renderSoundboxNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<title>Loa không khả dụng</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F6F7F5;color:#121417;display:grid;place-items:center;min-height:100vh;padding:20px}
  .card{max-width:420px;width:100%;background:#fff;padding:28px;border-radius:16px;border:1px solid rgba(18,20,23,.1);text-align:center}
  h1{font-size:18px;font-weight:800;margin-bottom:8px}
  p{font-size:14px;color:#525866;line-height:1.5}
</style>
</head>
<body>
  <main class="card">
    <h1>Liên kết Loa không khả dụng</h1>
    <p>Liên kết không hợp lệ, đã bị thu hồi hoặc đang tạm tắt.</p>
  </main>
</body>
</html>`;
}

function renderSoundboxHtml(row: SoundboxRow, rawToken: string, nonce: string): string {
  const nameEsc = escapeHtml(row.name);
  const langEsc = escapeHtml(row.voice_lang || 'vi-VN');
  const configJson = safeJsonForScript({
    name: row.name,
    token: rawToken,
    voiceLang: row.voice_lang || 'vi-VN',
    voiceTemplate: row.voice_template || 'Đã nhận {amountWords} {currency}',
    minAmount: row.min_amount,
  });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<title>Loa Thu Ngân — ${nameEsc}</title>
<style>
  :root{--bg:#FAFAFA;--card:#FFFFFF;--ink:#09090B;--secondary:#52525B;--muted:#71717A;--emerald:#047857;--emerald-soft:#ECFDF5;--emerald-border:#A7F3D0;--line:rgba(9,9,11,.08);--ease-out:cubic-bezier(.23,1,.32,1)}
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  :focus-visible{outline:2px solid var(--emerald);outline-offset:2px}
  body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;padding:20px 16px 36px;display:flex;flex-direction:column;align-items:center;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:960px;display:flex;flex-direction:column;gap:14px}
  .grid-kiosk{display:grid;gap:14px;grid-template-columns:1fr;align-items:start}
  @media(min-width:860px){.grid-kiosk{grid-template-columns:1.1fr 0.9fr}}
  .col-left{display:flex;flex-direction:column;gap:14px;min-width:0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(9,9,11,.03)}
  .top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;letter-spacing:-.02em}
  .dot{width:8px;height:8px;border-radius:99px;background:var(--emerald)}
  .badge{font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;background:var(--emerald-soft);color:var(--emerald);border:1px solid var(--emerald-border)}
  .badge.idle{background:#F4F4F5;color:var(--secondary);border-color:var(--line)}
  .hero{display:flex;flex-direction:column;gap:12px;background:var(--ink);color:#fff;border-radius:12px;padding:22px;border:1px solid var(--ink)}
  .hero-kicker{font-size:11.5px;color:#A1A1AA;font-weight:500;letter-spacing:.02em;text-transform:uppercase}
  .hero-amount{font-size:clamp(30px,5vw,44px);font-weight:700;font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#FAFAFA;letter-spacing:-.025em}
  .hero-speech{font-size:14px;color:#D4D4D8;line-height:1.5}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  button{cursor:pointer;border:0;border-radius:8px;min-height:40px;padding:0 15px;font-size:13px;font-weight:600;transition:transform 140ms var(--ease-out),background-color 140ms ease,border-color 140ms ease}
  button:active:not(:disabled){transform:scale(.97)}
  .btn-primary{background:var(--emerald);color:#fff}
  .btn-primary:hover{background:#065F46}
  .btn-ghost{background:rgba(255,255,255,.10);color:#FAFAFA;border:1px solid rgba(255,255,255,.14)}
  .btn-ghost:hover{background:rgba(255,255,255,.16)}
  .feed-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px}
  .feed-title{font-size:13px;font-weight:600;color:var(--ink)}
  .list{display:flex;flex-direction:column;gap:8px}
  .item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 13px;border:1px solid var(--line);border-radius:8px;background:#FAFAFA}
  .item-left{min-width:0;flex:1}
  .item-amt{font-size:15px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--emerald);font-variant-numeric:tabular-nums}
  .item-meta{font-size:12px;color:var(--secondary);margin-top:2px;word-break:break-word}
  .item-speak{min-height:34px;padding:0 11px;background:#fff;border:1px solid rgba(9,9,11,.12);color:var(--ink);font-size:12px;border-radius:7px}
  .item-speak:hover{background:#F4F4F5}
  .empty{font-size:13px;color:var(--muted);text-align:center;padding:24px 8px}
  .pos-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .pos-title{font-size:14px;font-weight:600;color:var(--ink)}
  .pos-chip{display:inline-flex;align-items:center;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;background:var(--emerald-soft);color:var(--emerald);border:1px solid var(--emerald-border)}
  .pos-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .pos-preset{min-height:32px;border:1px solid rgba(9,9,11,.11);background:#FAFAFA;color:var(--ink);border-radius:6px;padding:0 10px;font-size:12px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .pos-preset:hover{background:#F4F4F5}
  .pos-form{display:grid;gap:8px;grid-template-columns:1fr}
  .pos-form-btns{display:grid;gap:8px;grid-template-columns:1fr auto}
  .pos-input{min-height:40px;border-radius:7px;border:1px solid rgba(9,9,11,.13);padding:0 12px;font-size:13.5px;font-weight:500;width:100%;background:#fff;color:var(--ink)}
  .pos-input:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(9,9,11,.06)}
  .pos-btn{min-height:40px;border-radius:8px;border:0;padding:0 14px;font-size:13px;font-weight:600}
  .pos-btn-create{background:var(--ink);color:#fff}
  .pos-btn-create:hover{background:#18181B}
  .pos-btn-clear{background:#fff;color:var(--ink);border:1px solid rgba(9,9,11,.13)}
  .pos-btn-clear:hover{background:#F4F4F5}
  .pos-error{margin-top:8px;font-size:12.5px;color:#DC2626;font-weight:500;display:none}
  .pos-result{margin-top:14px;padding:14px;border-radius:10px;border:1px solid var(--line);background:#FAFAFA;display:none;gap:14px;align-items:center;flex-wrap:wrap}
  .pos-result.is-visible{display:flex}
  .pos-result.is-paid{background:var(--emerald-soft);border-color:var(--emerald-border)}
  .pos-qr-frame{width:164px;height:164px;background:#fff;border-radius:8px;padding:9px;border:1px solid var(--line);flex-shrink:0;display:grid;place-items:center}
  .pos-qr-frame svg{width:100%;height:100%;display:block}
  .pos-info{flex:1;min-width:190px}
  .pos-status{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:6px;font-size:11.5px;font-weight:600;background:#FEF3C7;color:#92400E;margin-bottom:8px}
  .pos-result.is-paid .pos-status{background:var(--emerald);color:#fff}
  .pos-amt-big{font-size:22px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);letter-spacing:-0.02em}
  .pos-meta{font-size:12.5px;color:var(--secondary);margin-top:4px;line-height:1.45}
  @media (prefers-reduced-motion:reduce){button{transition:none}}
</style>
</head>
<body>
  <main class="wrap">
    <section class="card top">
      <div class="brand">
        <span class="dot"></span>
        <span>${nameEsc}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge idle" id="statusBadge">Đang chờ bật loa</span>
        <span class="badge idle">${langEsc}</span>
      </div>
    </section>

    <div class="grid-kiosk">
      <div class="col-left">
        <section class="hero">
          <div class="hero-kicker">Giao dịch mới nhất</div>
          <div class="hero-amount" id="latestAmount">+0 đ</div>
          <div class="hero-speech" id="latestSpeech">Nhấn "Bật Âm Thanh" bên dưới một lần để cho phép trình duyệt phát chuông và giọng nói tự động.</div>
          <div class="actions">
            <button class="btn-primary" id="enableBtn" type="button">Bật Âm Thanh (Kích hoạt Loa)</button>
            <button class="btn-ghost" id="testBtn" type="button">Phát thử +80.000đ</button>
          </div>
        </section>

        <section class="card">
          <div class="feed-head">
            <div class="feed-title">Lịch sử nhận tiền gần đây</div>
            <div style="font-size:12px;color:var(--muted)" id="pollMeta">Cập nhật tự động</div>
          </div>
          <div class="list" id="eventsList">
            <div class="empty">Chưa có giao dịch tiền vào khớp bộ lọc loa.</div>
          </div>
        </section>
      </div>

      <section class="card pos-card" id="posSection">
        <div class="pos-head">
          <div class="pos-title">POS Mini Tạo mã VietQR 2-in-1</div>
          <span class="pos-chip">Tự động đối soát</span>
        </div>
        <div class="pos-presets" id="posPresets">
          <button class="pos-preset" type="button" data-pos-preset="20000">20.000đ</button>
          <button class="pos-preset" type="button" data-pos-preset="50000">50.000đ</button>
          <button class="pos-preset" type="button" data-pos-preset="100000">100.000đ</button>
          <button class="pos-preset" type="button" data-pos-preset="200000">200.000đ</button>
          <button class="pos-preset" type="button" data-pos-preset="500000">500.000đ</button>
        </div>
        <div class="pos-form">
          <input class="pos-input" id="posAmount" type="number" inputmode="numeric" min="1000" step="1000" placeholder="Nhập số tiền (VD: 50000)" aria-label="Số tiền cần thu" />
          <input class="pos-input" id="posNote" type="text" maxlength="64" placeholder="Nội dung chuyển khoản (tùy chọn)" aria-label="Nội dung chuyển khoản" />
          <div class="pos-form-btns">
            <button class="pos-btn pos-btn-create" id="posCreateBtn" type="button">Tạo QR</button>
            <button class="pos-btn pos-btn-clear" id="posClearBtn" type="button">Thu đơn mới</button>
          </div>
        </div>
        <div class="pos-error" id="posError"></div>
        <div class="pos-result" id="posResult">
          <div class="pos-qr-frame" id="posQrBox" aria-label="Mã VietQR thu ngân"></div>
          <div class="pos-info">
            <div class="pos-status" id="posStatus">Đang chờ khách chuyển khoản...</div>
            <div class="pos-amt-big" id="posAmountMeta">0 đ</div>
            <div class="pos-meta" id="posAccountMeta"></div>
            <div class="pos-meta" id="posNoteMeta"></div>
          </div>
        </div>
      </section>
    </div>
  </main>

<script nonce="${nonce}">
(() => {
  const cfg = ${configJson};
  const seenIds = new Set();
  const speechQueue = [];
  let audioCtx = null;
  let soundEnabled = false;
  let speaking = false;
  let cursor = null;
  let initialized = false;
  let idlePolls = 0;
  let pollTimer = null;
  const recentItems = [];

  const statusBadge = document.getElementById('statusBadge');
  const latestAmount = document.getElementById('latestAmount');
  const latestSpeech = document.getElementById('latestSpeech');
  const eventsList = document.getElementById('eventsList');
  const enableBtn = document.getElementById('enableBtn');
  const testBtn = document.getElementById('testBtn');
  const pollMeta = document.getElementById('pollMeta');

  function formatVnd(n) {
    return '+' + Number(n || 0).toLocaleString('vi-VN') + ' đ';
  }

  function playChime() {
    try {
      if (!audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        audioCtx = new AudioCtor();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const now = audioCtx.currentTime;
      const playTone = (freq, startOffset, duration) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.28, now + startOffset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration);
      };
      playTone(1046.5, 0, 0.22);
      playTone(1318.5, 0.14, 0.35);
    } catch {}
  }

  function drainQueue() {
    if (speaking || speechQueue.length === 0) return;
    const nextText = speechQueue.shift();
    if (!nextText) return;
    speaking = true;
    playChime();
    if ('speechSynthesis' in window) {
      setTimeout(() => {
        try {
          const utter = new SpeechSynthesisUtterance(nextText);
          const targetLang = String(cfg.voiceLang || 'vi-VN');
          const targetLower = targetLang.toLowerCase();
          const langPrefix = targetLower.split('-')[0] || 'vi';
          utter.lang = targetLang;
          utter.rate = 1.02;
          const voices = window.speechSynthesis.getVoices();
          const matchedVoice =
            voices.find((v) => v.lang && v.lang.toLowerCase() === targetLower) ||
            voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
          if (matchedVoice) utter.voice = matchedVoice;
          utter.onend = () => { speaking = false; drainQueue(); };
          utter.onerror = () => { speaking = false; drainQueue(); };
          window.speechSynthesis.speak(utter);
        } catch {
          speaking = false;
          drainQueue();
        }
      }, 280);
    } else {
      speaking = false;
      drainQueue();
    }
  }

  function enqueueSpeech(text) {
    if (!soundEnabled || !text) return;
    speechQueue.push(text);
    drainQueue();
  }

  function renderList() {
    if (recentItems.length === 0) return;
    eventsList.innerHTML = '';
    for (const ev of recentItems.slice(0, 15)) {
      const row = document.createElement('div');
      row.className = 'item';

      const left = document.createElement('div');
      left.className = 'item-left';

      const amt = document.createElement('div');
      amt.className = 'item-amt';
      amt.textContent = formatVnd(ev.amount) + (ev.isTest ? ' (TEST)' : '');

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = (ev.content || 'Không có nội dung') + ' — ' + (ev.speechText || '');

      left.appendChild(amt);
      left.appendChild(meta);

      const replayBtn = document.createElement('button');
      replayBtn.className = 'item-speak';
      replayBtn.type = 'button';
      replayBtn.textContent = 'Đọc lại';
      replayBtn.addEventListener('click', () => {
        if (!soundEnabled) {
          soundEnabled = true;
          statusBadge.textContent = 'Loa đang hoạt động';
          statusBadge.className = 'badge';
          enableBtn.textContent = 'Loa đã sẵn sàng';
        }
        enqueueSpeech(ev.speechText);
      });

      row.appendChild(left);
      row.appendChild(replayBtn);
      eventsList.appendChild(row);
    }
  }

  async function enableSound() {
    soundEnabled = true;
    statusBadge.textContent = 'Loa đang hoạt động';
    statusBadge.className = 'badge';
    enableBtn.textContent = 'Loa đang bật (Tự động đọc tiền vào)';
    playChime();
    try {
      if ('wakeLock' in navigator && navigator.wakeLock.request) {
        await navigator.wakeLock.request('screen');
      }
    } catch {}
  }

  const posAmountEl = document.getElementById('posAmount');
  const posNoteEl = document.getElementById('posNote');
  const posCreateBtn = document.getElementById('posCreateBtn');
  const posClearBtn = document.getElementById('posClearBtn');
  const posErrorEl = document.getElementById('posError');
  const posResultEl = document.getElementById('posResult');
  const posQrBoxEl = document.getElementById('posQrBox');
  const posStatusEl = document.getElementById('posStatus');
  const posAmountMetaEl = document.getElementById('posAmountMeta');
  const posAccountMetaEl = document.getElementById('posAccountMeta');
  const posNoteMetaEl = document.getElementById('posNoteMeta');

  let activePos = null;

  function renderPosSvgSafe(svgMarkup) {
    posQrBoxEl.textContent = '';
    if (!svgMarkup) return;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
      const root = doc.documentElement;
      if (root && root.tagName && root.tagName.toLowerCase() === 'svg') {
        posQrBoxEl.appendChild(document.importNode(root, true));
      }
    } catch {}
  }

  function showPosError(msg) {
    if (!msg) {
      posErrorEl.style.display = 'none';
      posErrorEl.textContent = '';
      return;
    }
    posErrorEl.textContent = msg;
    posErrorEl.style.display = 'block';
  }

  function clearPosQr() {
    activePos = null;
    showPosError('');
    posResultEl.classList.remove('is-visible', 'is-paid');
    posQrBoxEl.textContent = '';
    posAmountEl.value = '';
    posNoteEl.value = '';
    posAmountEl.focus();
  }

  async function generatePosQr(amountOverride) {
    if (amountOverride !== undefined) {
      posAmountEl.value = String(amountOverride);
    }
    const rawAmt = String(posAmountEl.value || '').trim();
    const amount = Number(rawAmt);
    if (!Number.isFinite(amount) || amount < 1000 || Math.floor(amount) !== amount) {
      showPosError('Vui lòng nhập số tiền hợp lệ (>= 1.000 đ).');
      return;
    }
    const note = String(posNoteEl.value || '').trim().slice(0, 64);
    showPosError('');
    posCreateBtn.disabled = true;
    try {
      const params = new URLSearchParams({ amount: String(amount) });
      if (note) params.set('note', note);
      const res = await fetch('/api/soundbox/' + encodeURIComponent(cfg.token) + '/pos-qr?' + params.toString(), {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.pos) {
        showPosError(data.error || 'Không thể tạo mã VietQR POS');
        return;
      }
      activePos = {
        amount: data.pos.amount,
        note: data.pos.note || '',
        status: 'waiting',
        createdAtMs: Date.now(),
      };
      renderPosSvgSafe(data.pos.qrSvg);
      posResultEl.classList.remove('is-paid');
      posResultEl.classList.add('is-visible');
      posStatusEl.textContent = 'Đang chờ khách chuyển khoản...';
      posAmountMetaEl.textContent = Number(data.pos.amount).toLocaleString('vi-VN') + ' đ';
      posAccountMetaEl.textContent =
        data.pos.bankShortName + ' ' + data.pos.accountNumber + ' (' + data.pos.accountName + ')';
      posNoteMetaEl.textContent = data.pos.note ? 'Nội dung: ' + data.pos.note : 'Không bắt buộc nội dung';
    } catch {
      showPosError('Lỗi kết nối khi tạo mã VietQR');
    } finally {
      posCreateBtn.disabled = false;
    }
  }

  function matchPosPayment(ev) {
    if (!activePos || activePos.status !== 'waiting') return;
    if (!ev || Number(ev.amount) < activePos.amount) return;
    const expectedNote = (activePos.note || '').trim().toUpperCase();
    const txContent = String(ev.content || '').toUpperCase();
    const noteMatches = !expectedNote || txContent.includes(expectedNote);
    const exactAmountFallback = Number(ev.amount) === activePos.amount;
    if (!noteMatches && !exactAmountFallback) return;
    activePos.status = 'paid';
    posResultEl.classList.add('is-paid');
    posStatusEl.textContent = 'Đã nhận đủ ' + formatVnd(ev.amount) + (ev.isTest ? ' (TEST)' : '');
  }

  posCreateBtn.addEventListener('click', () => { void generatePosQr(); });
  posClearBtn.addEventListener('click', clearPosQr);
  posAmountEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void generatePosQr(); }
  });
  document.getElementById('posPresets').addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-pos-preset]') : null;
    if (!btn) return;
    const val = Number(btn.getAttribute('data-pos-preset'));
    if (Number.isFinite(val) && val > 0) void generatePosQr(val);
  });

  enableBtn.addEventListener('click', enableSound);
  testBtn.addEventListener('click', async () => {
    if (!soundEnabled) await enableSound();
    latestAmount.textContent = '+80.000 đ (TEST)';
    latestSpeech.textContent = 'Đã nhận tám mươi nghìn đồng';
    enqueueSpeech('Đã nhận tám mươi nghìn đồng');
  });

  function computeNextPollDelayMs() {
    if (document.hidden) return 15000;
    if (idlePolls >= 12) return 15000;
    if (idlePolls >= 5) return 8000;
    return 4000;
  }

  function scheduleNextPoll(delayOverride) {
    if (pollTimer) clearTimeout(pollTimer);
    const delay = typeof delayOverride === 'number' ? delayOverride : computeNextPollDelayMs();
    pollTimer = setTimeout(pollEvents, delay);
  }

  async function pollEvents() {
    let hadNewEvents = false;
    try {
      const qs = cursor ? ('?since=' + encodeURIComponent(cursor) + '&limit=20') : '?limit=10';
      const resp = await fetch('/api/soundbox/' + encodeURIComponent(cfg.token) + '/events' + qs, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        pollMeta.textContent = 'Lỗi kết nối (' + resp.status + ')';
        idlePolls++;
        scheduleNextPoll();
        return;
      }
      const data = await resp.json();
      if (!data.ok) {
        idlePolls++;
        scheduleNextPoll();
        return;
      }
      if (data.nextCursor) cursor = data.nextCursor;
      pollMeta.textContent = 'Đã kết nối • ' + new Date().toLocaleTimeString('vi-VN');

      const events = Array.isArray(data.events) ? data.events : [];
      for (const ev of events) {
        if (seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        hadNewEvents = true;
        recentItems.unshift(ev);
        latestAmount.textContent = formatVnd(ev.amount) + (ev.isTest ? ' (TEST)' : '');
        latestSpeech.textContent = ev.speechText || '';
        if (initialized) {
          matchPosPayment(ev);
          enqueueSpeech(ev.speechText);
        }
      }
      if (!initialized && events.length > 0) {
        const lastEv = events[events.length - 1];
        latestAmount.textContent = formatVnd(lastEv.amount) + (lastEv.isTest ? ' (TEST)' : '');
        latestSpeech.textContent = lastEv.speechText || '';
      }
      initialized = true;
      renderList();
    } catch {
      pollMeta.textContent = 'Đang thử kết nối lại...';
    }
    idlePolls = hadNewEvents ? 0 : idlePolls + 1;
    scheduleNextPoll();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      idlePolls = 0;
      scheduleNextPoll(200);
    }
  });

  pollEvents();
})();
</script>
</body>
</html>`;
}

export function createSoundboxRoutes(): {
  soundboxes: Hono<AppContextEnv>;
  kiosk: Hono<AppContextEnv>;
  api: Hono<AppContextEnv>;
} {
  const soundboxes = new Hono<AppContextEnv>();
  soundboxes.use('*', requireWorkspaceAuth);
  soundboxes.use('*', requireLiveAuth);

  soundboxes.get('/', requireScope('soundboxes:read'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const rows = await c.env.DB.prepare(
      `SELECT * FROM soundboxes WHERE workspace_id = ? ORDER BY created_at DESC`
    )
      .bind(workspaceId)
      .all<SoundboxRow>();
    return c.json({ ok: true, soundboxes: rows.results.map(sanitizeSoundbox) });
  });

  soundboxes.post('/', requireLiveAuth, requireScope('soundboxes:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      bankAccountId?: string | null;
      voiceLang?: string;
      voiceTemplate?: string;
      minAmount?: number;
      enabled?: boolean;
    } | null;

    const name = String(body?.name || '').trim() || 'Loa Thu Ngân Quầy 1';
    const bankAccountId = body?.bankAccountId ? String(body.bankAccountId).trim() : null;
    const scope: 'all' | 'account' = bankAccountId ? 'account' : 'all';
    const voiceLang = String(body?.voiceLang || 'vi-VN').trim() || 'vi-VN';
    const voiceTemplate =
      String(body?.voiceTemplate || 'Đã nhận {amountWords} {currency}').trim() ||
      'Đã nhận {amountWords} {currency}';
    const minAmount =
      body?.minAmount !== undefined && Number.isFinite(body.minAmount)
        ? Math.max(0, Math.trunc(body.minAmount))
        : 0;

    if (bankAccountId) {
      const account = await c.env.DB.prepare(
        `SELECT id FROM bank_accounts WHERE id = ? AND workspace_id = ?`
      )
        .bind(bankAccountId, workspaceId)
        .first<BankAccountRow>();
      if (!account) {
        return c.json({ ok: false, error: 'Không tìm thấy tài khoản ngân hàng' }, 404);
      }
    }

    const id = `sb_${randomHex(10)}`;
    const kioskToken = `sbx_${randomBase64Url(24)}`;
    const kioskTokenHash = await sha256Hex(kioskToken);
    // Store only masked preview + non-secret id suffix in UNIQUE kiosk_token column (never plaintext secret)
    const storedTokenPreview = `${maskToken(kioskToken)}#${id}`;
    const nowIso = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO soundboxes (
        id, workspace_id, bank_account_id, scope, name, kiosk_token, kiosk_token_hash,
        voice_lang, voice_template, min_amount, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        workspaceId,
        bankAccountId,
        scope,
        name,
        storedTokenPreview,
        kioskTokenHash,
        voiceLang,
        voiceTemplate,
        minAmount,
        body?.enabled === false ? 0 : 1,
        nowIso,
        nowIso
      )
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'soundbox.created',
      resourceType: 'soundbox',
      resourceId: id,
      ip: getClientIp(c),
      meta: { name, minAmount, scope },
    });

    const created = await c.env.DB.prepare(`SELECT * FROM soundboxes WHERE id = ?`)
      .bind(id)
      .first<SoundboxRow>();
    const urls = buildSoundboxUrls(getBaseOrigin(c), kioskToken);

    return c.json(
      {
        ok: true,
        soundbox: sanitizeSoundbox(created!),
        kioskToken,
        kioskUrl: urls.kioskUrl,
        eventsUrl: urls.eventsUrl,
      },
      201
    );
  });

  soundboxes.patch('/:id', requireLiveAuth, requireScope('soundboxes:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT * FROM soundboxes WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<SoundboxRow>();
    if (!existing) {
      return c.json({ ok: false, error: 'Không tìm thấy Loa' }, 404);
    }

    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      bankAccountId?: string | null;
      voiceLang?: string;
      voiceTemplate?: string;
      minAmount?: number;
      enabled?: boolean;
    } | null;

    let nextAccountId = existing.bank_account_id;
    let nextScope: 'all' | 'account' = existing.scope ?? (existing.bank_account_id ? 'account' : 'all');
    if (body?.bankAccountId !== undefined) {
      nextAccountId = body.bankAccountId ? String(body.bankAccountId).trim() : null;
      nextScope = nextAccountId ? 'account' : 'all';
      if (nextAccountId) {
        const account = await c.env.DB.prepare(
          `SELECT id FROM bank_accounts WHERE id = ? AND workspace_id = ?`
        )
          .bind(nextAccountId, workspaceId)
          .first<BankAccountRow>();
        if (!account) {
          return c.json({ ok: false, error: 'Không tìm thấy tài khoản ngân hàng' }, 404);
        }
      }
    }

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE soundboxes
       SET name = ?, bank_account_id = ?, scope = ?, voice_lang = ?, voice_template = ?,
           min_amount = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(
        body?.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
        nextAccountId,
        nextScope,
        body?.voiceLang !== undefined
          ? String(body.voiceLang).trim() || existing.voice_lang
          : existing.voice_lang,
        body?.voiceTemplate !== undefined
          ? String(body.voiceTemplate).trim() || existing.voice_template
          : existing.voice_template,
        body?.minAmount !== undefined && Number.isFinite(body.minAmount)
          ? Math.max(0, Math.trunc(body.minAmount))
          : existing.min_amount,
        body?.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
        nowIso,
        id,
        workspaceId
      )
      .run();

    const updated = await c.env.DB.prepare(`SELECT * FROM soundboxes WHERE id = ?`)
      .bind(id)
      .first<SoundboxRow>();

    return c.json({ ok: true, soundbox: sanitizeSoundbox(updated!) });
  });

  soundboxes.post('/:id/rotate-token', requireLiveAuth, requireScope('soundboxes:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT id FROM soundboxes WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .first<{ id: string }>();
    if (!existing) {
      return c.json({ ok: false, error: 'Không tìm thấy Loa' }, 404);
    }

    const kioskToken = `sbx_${randomBase64Url(24)}`;
    const kioskTokenHash = await sha256Hex(kioskToken);
    const storedTokenPreview = `${maskToken(kioskToken)}#${randomHex(4)}`;
    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE soundboxes
       SET kiosk_token = ?, kiosk_token_hash = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
      .bind(storedTokenPreview, kioskTokenHash, nowIso, id, workspaceId)
      .run();

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'soundbox.token_rotated',
      resourceType: 'soundbox',
      resourceId: id,
      ip: getClientIp(c),
    });

    const urls = buildSoundboxUrls(getBaseOrigin(c), kioskToken);
    return c.json({
      ok: true,
      kioskToken,
      kioskUrl: urls.kioskUrl,
      eventsUrl: urls.eventsUrl,
    });
  });

  soundboxes.delete('/:id', requireLiveAuth, requireScope('soundboxes:write'), async (c) => {
    const workspaceId = c.get('workspaceId');
    const id = c.req.param('id');
    const res = await c.env.DB.prepare(
      `DELETE FROM soundboxes WHERE id = ? AND workspace_id = ?`
    )
      .bind(id, workspaceId)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      return c.json({ ok: false, error: 'Không tìm thấy Loa' }, 404);
    }

    await recordAuditLog(c.env, {
      workspaceId,
      actorType: c.get('userId') ? 'user' : 'api_key',
      actorId: c.get('userId') ?? c.get('apiKeyId'),
      action: 'soundbox.deleted',
      resourceType: 'soundbox',
      resourceId: id,
      ip: getClientIp(c),
    });

    return c.json({ ok: true });
  });

  const kiosk = new Hono<AppContextEnv>();
  kiosk.get('/:token', async (c) => {
    const token = c.req.param('token');
    c.header('Cache-Control', 'no-store');

    const row = await findSoundboxByToken(c.env.DB, token);
    if (!isSoundboxAuthorizedAndActive(row)) {
      const rl = await checkRateLimit(c.env.DB, `soundbox_bad:${getClientIp(c)}`, 60, 60);
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
      );
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfterSeconds));
        return c.text('Too many requests', 429);
      }
      // Uniform 404 for unknown, disabled, or orphaned account-scoped tokens (no Soundbox name leak)
      return c.html(renderSoundboxNotFoundHtml(), 404);
    }

    const nonce = randomBase64Url(16);
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`
    );
    return c.html(renderSoundboxHtml(row, token, nonce), 200);
  });

  async function handleEventsRequest(
    c: Context<AppContextEnv>,
    rawToken: string
  ): Promise<Response> {
    const token = rawToken.trim();
    const row = token ? await findSoundboxByToken(c.env.DB, token) : null;

    if (!isSoundboxAuthorizedAndActive(row)) {
      // PERF-H1: Only write D1 rate_limits on invalid/missing/disabled token lookups
      const rl = await checkRateLimit(c.env.DB, `soundbox_bad:${getClientIp(c)}`, 60, 60);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfterSeconds));
        return c.json({ ok: false, error: 'Too many requests' }, 429);
      }
      // SEC-H4: Uniform 404 for unknown, disabled, and orphaned account-scoped soundboxes
      return c.json({ ok: false, error: 'Soundbox not found' }, 404);
    }

    // PERF-H1: Lightweight isolate-local sliding window for valid soundboxes (0 D1 writes)
    if (!checkLocalPollLimit(row.id, 60, 60_000)) {
      return c.json({ ok: false, error: 'Too many polling requests' }, 429);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // PERF-H1: Throttle last_seen_at writes to at most once every 5 minutes (288x write reduction)
    const lastSeenMs = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN;
    if (
      !row.last_seen_at ||
      !Number.isFinite(lastSeenMs) ||
      nowMs - lastSeenMs >= SOUNDBOX_LAST_SEEN_THROTTLE_MS
    ) {
      const updatePromise = c.env.DB.prepare(
        `UPDATE soundboxes SET last_seen_at = ? WHERE id = ?`
      )
        .bind(nowIso, row.id)
        .run()
        .catch(() => {});
      try {
        c.executionCtx.waitUntil(updatePromise);
      } catch {
        await updatePromise;
      }
    }

    const rawSince = (c.req.query('since') || '').trim();
    const limitRaw = Number.parseInt(c.req.query('limit') || '20', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;

    // SEC-H4: Clamp ?since= to at most 24h in the past & ALWAYS normalize to canonical ISO-8601 UTC
    // so non-canonical Date.parse() strings (e.g. '+002026-...' or '11/26/2026') cannot bypass SQLite comparison.
    const minAllowedMs = nowMs - SOUNDBOX_MAX_LOOKBACK_MS;
    const defaultLookbackIso = new Date(nowMs - SOUNDBOX_DEFAULT_LOOKBACK_MS).toISOString();

    let effectiveSince: string;
    let isCursorPoll = false;
    if (rawSince) {
      const parsedMs = Date.parse(rawSince);
      if (Number.isFinite(parsedMs)) {
        isCursorPoll = true;
        effectiveSince = new Date(Math.max(parsedMs, minAllowedMs)).toISOString();
      } else {
        effectiveSince = defaultLookbackIso;
      }
    } else {
      effectiveSince = defaultLookbackIso;
    }

    // CRIT-3: Never announce cm_test_ sandbox simulator transactions ('simulator_sandbox') on live Soundboxes
    const conditions = [
      `workspace_id = ?`,
      `direction = 'in'`,
      `amount >= ?`,
      `source != 'simulator_sandbox'`,
    ];
    const bindings: Array<string | number> = [row.workspace_id, row.min_amount];

    if (row.bank_account_id) {
      conditions.push(`bank_account_id = ?`);
      bindings.push(row.bank_account_id);
    }

    if (isCursorPoll) {
      conditions.push(`created_at > ?`);
      bindings.push(effectiveSince);
    } else {
      conditions.push(`created_at >= ?`);
      bindings.push(effectiveSince);
    }

    const orderDir = isCursorPoll ? 'ASC' : 'DESC';
    const sql = `SELECT * FROM transactions
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY created_at ${orderDir}
                 LIMIT ?`;
    bindings.push(limit);

    const txRows = await c.env.DB.prepare(sql)
      .bind(...bindings)
      .all<TransactionRow>();

    const chronological = isCursorPoll ? txRows.results : [...txRows.results].reverse();
    const events = chronological.map((tx) => ({
      id: tx.id,
      txId: tx.bank_tx_id,
      bankCode: tx.bank_code,
      accountNumber: maskAccountNumber(tx.account_number),
      amount: tx.amount,
      currency: tx.currency,
      content: tx.content,
      senderName: tx.sender_name,
      isTest: tx.is_test === 1,
      occurredAt: tx.occurred_at,
      createdAt: tx.created_at,
      amountWords: vndToVietnameseWords(tx.amount),
      speechText: formatSoundboxSpeech({
        amount: tx.amount,
        currency: tx.currency,
        content: tx.content,
        senderName: tx.sender_name ?? undefined,
        template: row.voice_template,
      }),
    }));

    const latestCursor =
      events.length > 0
        ? events[events.length - 1]!.createdAt
        : isCursorPoll
          ? effectiveSince
          : nowIso;

    return c.json({
      ok: true,
      soundbox: {
        id: row.id,
        name: row.name,
        voiceLang: row.voice_lang,
        minAmount: row.min_amount,
      },
      serverTime: nowIso,
      nextCursor: latestCursor,
      events,
    });
  }

  async function resolvePosAccountForSoundbox(
    db: D1Database,
    row: SoundboxRow,
    requestedBankAccountId?: string
  ): Promise<BankAccountRow | null> {
    if (row.scope === 'account') {
      if (!row.bank_account_id) return null;
      return db
        .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ? AND enabled = 1`)
        .bind(row.bank_account_id, row.workspace_id)
        .first<BankAccountRow>();
    }
    if (requestedBankAccountId) {
      const explicit = await db
        .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ? AND enabled = 1`)
        .bind(requestedBankAccountId, row.workspace_id)
        .first<BankAccountRow>();
      if (explicit) return explicit;
    }
    return db
      .prepare(
        `SELECT * FROM bank_accounts WHERE workspace_id = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1`
      )
      .bind(row.workspace_id)
      .first<BankAccountRow>();
  }

  async function handlePosQrRequest(
    c: Context<AppContextEnv>,
    rawToken: string
  ): Promise<Response> {
    c.header('Cache-Control', 'no-store');
    const token = rawToken.trim();
    const row = token ? await findSoundboxByToken(c.env.DB, token) : null;

    if (!isSoundboxAuthorizedAndActive(row)) {
      const rl = await checkRateLimit(c.env.DB, `soundbox_bad:${getClientIp(c)}`, 60, 60);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfterSeconds));
        return c.json({ ok: false, error: 'Too many requests' }, 429);
      }
      return c.json({ ok: false, error: 'Soundbox not found' }, 404);
    }

    if (!checkLocalPollLimit(row.id, 60, 60_000)) {
      return c.json({ ok: false, error: 'Too many requests' }, 429);
    }

    const rawAmount = (c.req.query('amount') || '').trim();
    let amount: number | undefined;
    if (rawAmount !== '') {
      if (!/^\d{1,12}$/.test(rawAmount)) {
        return c.json({ ok: false, error: 'Số tiền không hợp lệ' }, 400);
      }
      const parsed = Number(rawAmount);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 500_000_000_000) {
        return c.json({ ok: false, error: 'Số tiền phải lớn hơn 0 VND' }, 400);
      }
      amount = parsed;
    }

    const note = (c.req.query('note') || c.req.query('des') || '').trim().slice(0, 64);
    const requestedBankAccountId = (c.req.query('bankAccountId') || '').trim() || undefined;
    const account = await resolvePosAccountForSoundbox(c.env.DB, row, requestedBankAccountId);
    if (!account) {
      return c.json(
        { ok: false, error: 'Loa chưa có tài khoản ngân hàng nào đang bật để tạo VietQR' },
        404
      );
    }

    const meta = getBankMetadata(account.bank_code);
    const qr = createVietQR({
      bankBin: account.bank_bin,
      accountNumber: account.account_number,
      amount,
      transferNote: note || undefined,
      lightColor: '#FFFFFF',
    });

    return c.json({
      ok: true,
      pos: {
        bankAccountId: account.id,
        bankCode: account.bank_code,
        bankName: meta?.name || account.bank_code,
        bankShortName: meta?.shortName || account.bank_code,
        bankBin: account.bank_bin,
        accountNumber: account.account_number,
        accountName: account.account_name,
        amount: amount ?? null,
        note,
        emvco: qr.emvco,
        qrSvg: qr.svg,
      },
    });
  }

  const api = new Hono<AppContextEnv>();
  // Support Authorization: Bearer <token> for ESP32 / IoT clients (no secret in URL path)
  api.get('/events', (c) => handleEventsRequest(c, extractBearerToken(c)));
  api.get('/:token/events', (c) =>
    handleEventsRequest(c, extractBearerToken(c) || c.req.param('token'))
  );
  api.get('/pos-qr', (c) => handlePosQrRequest(c, extractBearerToken(c)));
  api.get('/:token/pos-qr', (c) =>
    handlePosQrRequest(c, extractBearerToken(c) || c.req.param('token'))
  );

  return { soundboxes, kiosk, api };
}
