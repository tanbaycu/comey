export type AppsScriptMode = 'cloud_bridge' | 'standalone';

export interface AppsScriptGeneratorConfig {
  mode: AppsScriptMode;
  ingestUrl: string;
  expectedAccountNo: string;
  bankDomains?: string[];
  processedLabel?: string;
  maxAgeMinutes?: number;
  maxTrackedMsgIds?: number;
  retryWindowMinutes?: number;
  secretPropertyName?: string;
  inlineSecret?: string;
}

export function generateAppsScriptCode(config: AppsScriptGeneratorConfig): string {
  const mode: AppsScriptMode = config.mode === 'standalone' ? 'standalone' : 'cloud_bridge';
  const ingestUrl = String(config.ingestUrl || '').trim();
  if (!ingestUrl) {
    throw new Error('ingestUrl is required');
  }
  const expectedAccountNo = String(config.expectedAccountNo || '').replace(/\D/g, '');
  if (!expectedAccountNo) {
    throw new Error('expectedAccountNo must contain digits');
  }

  const bankDomains =
    config.bankDomains && config.bankDomains.length > 0
      ? config.bankDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : ['cake.vn'];

  const runtimeConfig = {
    MODE: mode,
    INGEST_URL: ingestUrl,
    EXPECTED_ACCOUNT_NO: expectedAccountNo,
    BANK_DOMAINS: bankDomains,
    PROCESSED_LABEL: String(config.processedLabel || 'Comey_Done').trim() || 'Comey_Done',
    MAX_AGE_MINUTES: Math.max(5, Math.floor(config.maxAgeMinutes ?? 25)),
    MAX_TRACKED_MSG_IDS: Math.max(50, Math.floor(config.maxTrackedMsgIds ?? 300)),
    RETRY_WINDOW_MINUTES: Math.max(1, Math.floor(config.retryWindowMinutes ?? 5)),
    SECRET_PROPERTY_NAME:
      String(config.secretPropertyName || 'COMEY_INGEST_SECRET').trim() || 'COMEY_INGEST_SECRET',
    FALLBACK_SECRET:
      String(config.inlineSecret || 'PASTE_COMEY_SECRET_HERE').trim() || 'PASTE_COMEY_SECRET_HERE',
  };

  const rawDomainQuery = bankDomains.map((d) => `from:${d}`).join(' OR ');
  const searchQuery = bankDomains.length > 1 ? `(${rawDomainQuery})` : rawDomainQuery;

  return `/**
 * Comey Payment Bridge — Google Apps Script (${mode})
 *
 * HƯỚNG DẪN CÀI ĐẶT NHANH:
 * 1. Mở https://script.google.com bằng Gmail đang nhận email biến động số dư ngân hàng.
 * 2. Tạo Project mới, dán toàn bộ file này vào Code.gs và bấm Save (Ctrl+S).
 * 3. Vào Project Settings -> Script Properties -> thêm ${runtimeConfig.SECRET_PROPERTY_NAME}.
 * 4. Chạy hàm testDryRun() để cấp quyền Gmail và kiểm tra đọc email gần nhất (không gửi webhook).
 * 5. Chạy hàm setupAutoTrigger() đúng 1 lần để bật quét nền mỗi 1 phút.
 * 6. (Khuyên dùng) Deploy -> New deployment -> Web app (Execute as: Me, Anyone) để quét tức thì qua doPost().
 */

var COMEY_CONFIG = ${JSON.stringify(runtimeConfig, null, 2)};

function getIngestSecret_() {
  var prop = PropertiesService.getScriptProperties().getProperty(COMEY_CONFIG.SECRET_PROPERTY_NAME);
  if (prop && prop.trim()) return prop.trim();
  if (COMEY_CONFIG.FALLBACK_SECRET && COMEY_CONFIG.FALLBACK_SECRET !== 'PASTE_COMEY_SECRET_HERE') {
    return COMEY_CONFIG.FALLBACK_SECRET.trim();
  }
  throw new Error('Missing secret in Script Properties: ' + COMEY_CONFIG.SECRET_PROPERTY_NAME);
}

function getHeaderSafe_(msg, headerName) {
  try {
    if (typeof msg.getHeader === 'function') {
      return String(msg.getHeader(headerName) || '');
    }
  } catch (_) {}
  return '';
}

function stripQuotedAndComments_(input) {
  var out = '';
  var inQuotes = false;
  var commentDepth = 0;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '\\\\') { i++; }
      else if (ch === '"') { inQuotes = false; }
      continue;
    }
    if (commentDepth > 0) {
      if (ch === '\\\\') { i++; }
      else if (ch === '(') { commentDepth++; }
      else if (ch === ')') { commentDepth--; }
      continue;
    }
    if (ch === '"') { inQuotes = true; out += ' '; }
    else if (ch === '(') { commentDepth = 1; out += ' '; }
    else { out += ch; }
  }
  return out;
}

function extractDomainSafe_(headerVal) {
  var stripped = stripQuotedAndComments_(String(headerVal || '')).trim();
  if (!stripped) return '';
  var regex = stripped.indexOf('<') !== -1 || stripped.indexOf('>') !== -1
    ? /<\\s*[^<>\\s@]+@([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})\\s*>/g
    : /[^\\s@<>]+@([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})/g;
  var last = '';
  var m;
  while ((m = regex.exec(stripped)) !== null) {
    if (m[1]) last = m[1].toLowerCase();
  }
  return last;
}

function domainMatchesAllowed_(domain, allowedList) {
  if (!domain) return false;
  for (var i = 0; i < allowedList.length; i++) {
    var a = String(allowedList[i] || '').toLowerCase();
    if (!a) continue;
    if (domain === a || domain.slice(-(a.length + 1)) === '.' + a) return true;
  }
  return false;
}

function verifyDkimHeader_(authResultsHeader, allowedDomains) {
  var raw = String(authResultsHeader || '').replace(/\\r?\\n[ \\t]+/g, ' ').trim();
  if (!raw) return { ok: false, reason: 'Missing Authentication-Results header' };
  var segments = raw.split(';');
  var alignedSigner = '';
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    if (/\\bdkim=fail\\b/i.test(seg)) {
      return { ok: false, reason: 'DKIM signature failed verification' };
    }
    var dkimMatch = seg.match(/\\bdkim=pass\\b/i);
    if (!dkimMatch) continue;
    var domMatch = seg.match(/\\bheader\\.d=([^\\s;]+)/i) || seg.match(/\\bheader\\.i=@?([^\\s;]+)/i);
    var signer = domMatch && domMatch[1] ? domMatch[1].trim().toLowerCase() : '';
    if (!alignedSigner && domainMatchesAllowed_(signer, allowedDomains)) {
      alignedSigner = signer;
    }
  }
  if (alignedSigner) {
    return { ok: true, signer: alignedSigner };
  }
  return { ok: false, reason: 'No aligned DKIM=pass found in Authentication-Results' };
}

function decodeHtmlEntities_(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\\d+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function htmlToStructuredLines_(htmlOrText) {
  var s = String(htmlOrText || '')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<\\/t[dh]\\s*>/gi, '\\t')
    .replace(/<br\\s*\\/?>|<\\/tr\\s*>|<\\/p\\s*>|<\\/div\\s*>|<\\/li\\s*>/gi, '\\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities_(s)
    .normalize('NFC')
    .split(/\\r?\\n/)
    .map(function (line) {
      return line
        .replace(/[ \\u00A0]+/g, ' ')
        .replace(/ *\\t+ */g, '\\t')
        .replace(/\\t+/g, '\\t')
        .trim();
    })
    .filter(Boolean);
}

function extractFieldAfterLabel_(lines, labelPatternStr) {
  var cleanPattern = String(labelPatternStr || '').replace(/^\\^/, '').replace(/\\$$/, '');
  var exactRegex = new RegExp('^(?:' + cleanPattern + ')\\\\s*[:：]?$', 'i');
  var inlineRegex = new RegExp('^(?:' + cleanPattern + ')\\\\s*[:：]?\\\\s+(.+)$', 'i');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('\\t') !== -1) {
      var cols = line.split('\\t').map(function (c) { return c.trim(); }).filter(Boolean);
      if (cols.length >= 2 && exactRegex.test(cols[0])) {
        return cols.slice(1).join(' ').trim();
      }
      if (cols.length === 1 && exactRegex.test(cols[0]) && i + 1 < lines.length) {
        return lines[i + 1].trim();
      }
    }
    var inlineMatch = line.match(inlineRegex);
    if (inlineMatch && inlineMatch[1] && inlineMatch[1].trim()) {
      return inlineMatch[1].trim();
    }
    if (exactRegex.test(line) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  return '';
}

function parseCakeStandalone_(msg, authResults) {
  var from = String(msg.getFrom() || '');
  var fromDomain = extractDomainSafe_(from);
  if (!domainMatchesAllowed_(fromDomain, COMEY_CONFIG.BANK_DOMAINS)) {
    return { valid: false, ignored: true, reason: 'Sender domain mismatch (' + fromDomain + ')' };
  }

  var dkimCheck = verifyDkimHeader_(authResults, COMEY_CONFIG.BANK_DOMAINS);
  if (!dkimCheck.ok) {
    return { valid: false, quarantine: true, reason: 'Anti-Spoofing: ' + dkimCheck.reason };
  }

  var html = '';
  var plain = '';
  try { html = msg.getBody() || ''; } catch (_) {}
  try { plain = msg.getPlainBody() || ''; } catch (_) {}

  var htmlLines = html ? htmlToStructuredLines_(html) : [];
  var plainLines = plain ? htmlToStructuredLines_(plain) : [];
  var lines = htmlLines.length > 0 ? htmlLines : plainLines;
  var joinedText = lines.join('\\n');

  var amountRaw = extractFieldAfterLabel_(lines, 'Số tiền');
  if (!amountRaw) {
    var fallbackAmt = joinedText.match(/Số tiền[\\s\\t:]*([+-]?\\s*\\d[\\d.,]*\\s*(?:đ|VND)?)/i);
    if (fallbackAmt) amountRaw = fallbackAmt[1];
  }
  if (!amountRaw) {
    return { valid: false, ignored: true, reason: 'No Số tiền field found' };
  }

  var trimmedAmt = amountRaw.trim();
  if (trimmedAmt.charAt(0) === '-') {
    return { valid: false, ignored: true, reason: 'Outgoing transfer ignored' };
  }
  if (trimmedAmt.charAt(0) !== '+') {
    return { valid: false, reason: 'Amount does not start with +' };
  }

  var amtMatch = trimmedAmt.match(/^\\+\\s*(?:(\\d{1,3}(?:\\.\\d{3})+)(?:,00)?|(\\d{1,3}(?:,\\d{3})+)(?:\\.00)?|(\\d+)(?:[.,]00)?)(?:\\s*(?:đ|₫|vnd)(?=$|[\\s(,;.])|(?=$|[\\s(]))/i);
  var amtNumStr = amtMatch ? (amtMatch[1] || amtMatch[2] || amtMatch[3] || '').replace(/[.,]/g, '') : '';
  var amount = amtNumStr ? Number(amtNumStr) : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000000) {
    return { valid: false, reason: 'Invalid amount: ' + amountRaw };
  }

  var receiverAcc = extractFieldAfterLabel_(lines, 'Tài khoản nhận|Tài khoản thụ hưởng|Số tài khoản nhận');
  var accTokenRe = /(?:^|[^A-Za-z0-9])([0-9*xX](?:[0-9*xX]|[\\s-](?=[0-9*xX]))*)(?![A-Za-z0-9])/g;
  var accToken = '';
  var accM;
  while ((accM = accTokenRe.exec(String(receiverAcc || ''))) !== null) {
    var cand = accM[1] ? accM[1].replace(/[\\s-]/g, '') : '';
    if (/\\d/.test(cand)) {
      accToken = cand;
      break;
    }
  }
  var accMatches = false;
  if (accToken && /\\d/.test(accToken)) {
    if (!/[*xX]/.test(accToken)) {
      accMatches = accToken === COMEY_CONFIG.EXPECTED_ACCOUNT_NO;
    } else {
      var vis = accToken.replace(/[^0-9]/g, '');
      if (vis.length >= Math.min(4, COMEY_CONFIG.EXPECTED_ACCOUNT_NO.length) && vis.length < COMEY_CONFIG.EXPECTED_ACCOUNT_NO.length) {
        var maskRe = new RegExp('^' + accToken.split(/[*xX]+/).map(function (p) { return p.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }).join('\\\\d+') + '$');
        accMatches = maskRe.test(COMEY_CONFIG.EXPECTED_ACCOUNT_NO);
      }
    }
  }
  if (!accMatches) {
    return { valid: false, ignored: true, reason: 'Receiver account mismatch (' + receiverAcc + ')' };
  }

  var txIdRaw = extractFieldAfterLabel_(lines, 'Mã giao dịch');
  var txId = String(txIdRaw || '').replace(/[^\\w-]/g, '');
  if (!txId || txId.length < 4) {
    return { valid: false, reason: 'Missing Mã giao dịch' };
  }

  var content = extractFieldAfterLabel_(lines, 'Nội dung giao dịch')
    .replace(/\\s*Cảm ơn bạn đã sử dụng dịch vụ[\\s\\S]*$/i, '')
    .trim();

  return {
    valid: true,
    payload: {
      source: 'apps_script',
      bankCode: 'CAKE',
      bankBin: '546034',
      txId: txId,
      accountNumber: COMEY_CONFIG.EXPECTED_ACCOUNT_NO,
      direction: 'in',
      amount: amount,
      currency: 'VND',
      content: content,
      occurredAt: extractFieldAfterLabel_(lines, 'Ngày giờ giao dịch') || msg.getDate().toISOString(),
      senderName: extractFieldAfterLabel_(lines, 'Tên người chuyển') || '',
      senderBank: extractFieldAfterLabel_(lines, 'Ngân hàng chuyển') || '',
      emailMessageId: msg.getId(),
      dkimSigner: dkimCheck.signer
    }
  };
}

function buildBridgePayload_(msg) {
  var authResults = getHeaderSafe_(msg, 'Authentication-Results');
  var arcAuthResults = getHeaderSafe_(msg, 'ARC-Authentication-Results');
  var arcSeal = getHeaderSafe_(msg, 'ARC-Seal');
  var htmlBody = '';
  var textBody = '';
  try { htmlBody = msg.getBody() || ''; } catch (_) {}
  try { textBody = msg.getPlainBody() || ''; } catch (_) {}

  return {
    source: 'apps_script',
    messageId: msg.getId(),
    from: String(msg.getFrom() || ''),
    to: String(msg.getTo() || ''),
    subject: String(msg.getSubject() || ''),
    date: msg.getDate().toISOString(),
    htmlBody: htmlBody,
    textBody: textBody,
    authenticationResults: authResults,
    headers: {
      'authentication-results': authResults,
      'arc-authentication-results': arcAuthResults,
      'arc-seal': arcSeal
    }
  };
}

function getProcessedMsgIdSet_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PROCESSED_MSG_IDS');
  if (!raw) return { list: [], set: {} };
  try {
    var list = JSON.parse(raw);
    if (!Array.isArray(list)) return { list: [], set: {} };
    var set = {};
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    return { list: list, set: set };
  } catch (_) {
    return { list: [], set: {} };
  }
}

function saveProcessedMsgIds_(list) {
  var trimmed = list.slice(-COMEY_CONFIG.MAX_TRACKED_MSG_IDS);
  PropertiesService.getScriptProperties().setProperty('PROCESSED_MSG_IDS', JSON.stringify(trimmed));
}

function getOrCreateLabel_(name) {
  var lb = GmailApp.getUserLabelByName(name);
  if (!lb) lb = GmailApp.createLabel(name);
  return lb;
}

function postIngest_(secret, bodyObj) {
  var resp = UrlFetchApp.fetch(COMEY_CONFIG.INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + secret
    },
    payload: JSON.stringify(bodyObj)
  });

  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + text.slice(0, 200));
  }

  var json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return json || { ok: true };
}

function pollBankEmails() {
  var stats = { ok: true, scanned: 0, dispatched: 0, matched: 0, skipped: 0 };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return Object.assign(stats, { busy: true });
  }

  try {
    var secret = getIngestSecret_();
    var props = PropertiesService.getScriptProperties();
    var installedAtMs = parseInt(props.getProperty('INSTALLED_AT_MS') || '0', 10) || 0;
    var ageCutoffMs = Date.now() - COMEY_CONFIG.MAX_AGE_MINUTES * 60 * 1000;
    var effectiveCutoffMs = Math.max(installedAtMs, ageCutoffMs);

    var doneLabel = getOrCreateLabel_(COMEY_CONFIG.PROCESSED_LABEL);
    var tracked = getProcessedMsgIdSet_();
    var modifiedTracked = false;

    var threads = GmailApp.search(${JSON.stringify(searchQuery)} + ' newer_than:1d', 0, 20);
    for (var t = 0; t < threads.length; t++) {
      var thread = threads[t];
      var msgs = thread.getMessages();
      var threadFullyHandled = true;
      var touchedAnyRecent = false;

      for (var m = msgs.length - 1; m >= 0; m--) {
        var msg = msgs[m];
        var msgTimeMs = msg.getDate().getTime();
        if (msgTimeMs < effectiveCutoffMs) break;

        var msgId = msg.getId();
        if (tracked.set[msgId]) continue;
        touchedAnyRecent = true;
        stats.scanned++;

        var payloadToSend = null;
        if (COMEY_CONFIG.MODE === 'standalone') {
          var authRes = getHeaderSafe_(msg, 'Authentication-Results');
          var parsed = parseCakeStandalone_(msg, authRes);
          if (!parsed.valid) {
            Logger.log('[SKIP msg=' + msgId + '] ' + parsed.reason);
            stats.skipped++;
            tracked.list.push(msgId);
            tracked.set[msgId] = true;
            modifiedTracked = true;
            continue;
          }
          payloadToSend = parsed.payload;
        } else {
          payloadToSend = buildBridgePayload_(msg);
        }

        try {
          var res = postIngest_(secret, payloadToSend);
          stats.dispatched++;
          var ageMs = Date.now() - msgTimeMs;
          var shouldRetry = Boolean(res && res.retry === true) && ageMs < COMEY_CONFIG.RETRY_WINDOW_MINUTES * 60 * 1000;

          if (shouldRetry) {
            threadFullyHandled = false;
          } else {
            if (res && res.matched === true) stats.matched++;
            tracked.list.push(msgId);
            tracked.set[msgId] = true;
            modifiedTracked = true;
            msg.markRead();
          }
        } catch (err) {
          threadFullyHandled = false;
          Logger.log('[RETRY msg=' + msgId + '] ' + err.message);
        }
      }

      if (touchedAnyRecent && threadFullyHandled) {
        thread.addLabel(doneLabel);
      }
    }

    if (modifiedTracked) {
      saveProcessedMsgIds_(tracked.list);
    }
    return stats;
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    var body = raw ? JSON.parse(raw) : {};
    var expectedSecret = getIngestSecret_();
    var providedSecret = body && body.secret ? String(body.secret).trim() : '';
    if (!providedSecret || providedSecret !== expectedSecret) {
      return out({ ok: false, error: 'Unauthorized' });
    }
    return out(pollBankEmails());
  } catch (err) {
    return out({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function testDryRun() {
  var threads = GmailApp.search(${JSON.stringify(searchQuery)}, 0, 10);
  Logger.log('Found ' + threads.length + ' threads for query');
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    var msg = msgs[msgs.length - 1];
    var authRes = getHeaderSafe_(msg, 'Authentication-Results');
    var parsed = parseCakeStandalone_(msg, authRes);
    Logger.log('[' + (i + 1) + '] ' + msg.getSubject() + ' -> ' + JSON.stringify(parsed));
  }
}

function setupAutoTrigger() {
  getIngestSecret_();
  getOrCreateLabel_(COMEY_CONFIG.PROCESSED_LABEL);

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pollBankEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  PropertiesService.getScriptProperties().setProperty('INSTALLED_AT_MS', String(Date.now()));
  ScriptApp.newTrigger('pollBankEmails').timeBased().everyMinutes(1).create();
  Logger.log('Installed 1-minute trigger for pollBankEmails');
}

function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pollBankEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
`;
}
