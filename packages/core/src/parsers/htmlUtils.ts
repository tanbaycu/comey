const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const HTML_ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;
const COMBINING_MARKS_RE = /[\u0300-\u036f]/;
const WS_SPACE_RE = /[ \u00A0]{2,}/g;
const TAB_SPACE_RE = / *\t+ */g;

const MAX_HTML_INPUT_CHARS = 262_144;
const MAX_STRUCTURED_LINES = 512;

const LABEL_REGEX_CACHE = new Map<string, { exact: RegExp; inline: RegExp }>();
const MAX_LABEL_CACHE_SIZE = 128;

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  const input = String(str);
  if (!input.includes('&')) return input;

  return input.replace(
    HTML_ENTITY_RE,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10);
        if (code === 160) return ' ';
        if (code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
        return match;
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        if (code === 160) return ' ';
        if (code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
        return match;
      }
      if (named !== undefined) {
        const mapped = NAMED_HTML_ENTITIES[named.toLowerCase()];
        if (mapped !== undefined) return mapped;
      }
      return match;
    }
  );
}

function finalizeStructuredLine(rawLine: string): string {
  if (!rawLine) return '';
  let line = rawLine.includes('&') ? decodeHtmlEntities(rawLine) : rawLine;
  if (line.includes('\u00A0')) {
    line = line.replace(/\u00A0/g, ' ');
  }
  if (line.includes('  ')) {
    line = line.replace(WS_SPACE_RE, ' ');
  }
  if (line.includes('\t')) {
    line = line.replace(TAB_SPACE_RE, '\t');
  }
  line = line.trim();
  if (!line) return '';
  if (COMBINING_MARKS_RE.test(line)) {
    line = line.normalize('NFC');
  }
  return line;
}

function pushLinesFromChunk(chunk: string, result: string[], lineBuf: { text: string }): void {
  if (!chunk) return;
  let start = 0;
  let nlIdx = chunk.indexOf('\n');
  while (nlIdx !== -1) {
    let part = chunk.slice(start, nlIdx);
    if (part.endsWith('\r')) part = part.slice(0, -1);
    const full = lineBuf.text ? lineBuf.text + part : part;
    lineBuf.text = '';
    const cleaned = finalizeStructuredLine(full);
    if (cleaned) {
      result.push(cleaned);
      if (result.length >= MAX_STRUCTURED_LINES) return;
    }
    start = nlIdx + 1;
    nlIdx = chunk.indexOf('\n', start);
  }
  if (start < chunk.length) {
    let tail = chunk.slice(start);
    if (tail.endsWith('\r')) tail = tail.slice(0, -1);
    lineBuf.text += tail;
  }
}

export function htmlToStructuredLines(htmlOrText: string): string[] {
  if (!htmlOrText) return [];
  let raw = String(htmlOrText);
  if (raw.length > MAX_HTML_INPUT_CHARS) {
    raw = raw.slice(0, MAX_HTML_INPUT_CHARS);
  }

  const result: string[] = [];
  const lineBuf = { text: '' };

  // Fast path for plain text without HTML tags
  let ltIdx = raw.indexOf('<');
  if (ltIdx === -1) {
    pushLinesFromChunk(raw, result, lineBuf);
    if (result.length < MAX_STRUCTURED_LINES && lineBuf.text) {
      const cleaned = finalizeStructuredLine(lineBuf.text);
      if (cleaned) result.push(cleaned);
    }
    return result;
  }

  const lower = raw.toLowerCase();
  const len = raw.length;
  let pos = 0;

  while (pos < len && result.length < MAX_STRUCTURED_LINES) {
    if (ltIdx === -1) {
      pushLinesFromChunk(raw.slice(pos), result, lineBuf);
      break;
    }
    if (ltIdx > pos) {
      pushLinesFromChunk(raw.slice(pos, ltIdx), result, lineBuf);
      if (result.length >= MAX_STRUCTURED_LINES) break;
    }

    // HTML comment <!-- ... -->
    if (raw.startsWith('<!--', ltIdx)) {
      const endComment = raw.indexOf('-->', ltIdx + 4);
      if (endComment === -1) break;
      lineBuf.text += ' ';
      pos = endComment + 3;
      ltIdx = raw.indexOf('<', pos);
      continue;
    }

    const gtIdx = raw.indexOf('>', ltIdx + 1);
    if (gtIdx === -1) break;

    // Extract tag name from lowercased view without extra regex scanning
    let tStart = ltIdx + 1;
    const isClosing = lower.charCodeAt(tStart) === 47; // '/'
    if (isClosing) tStart++;
    let tEnd = tStart;
    while (tEnd < gtIdx) {
      const code = lower.charCodeAt(tEnd);
      if (code >= 97 && code <= 122) {
        tEnd++;
      } else {
        break;
      }
    }
    const tag = lower.slice(tStart, tEnd);

    if (!isClosing && (tag === 'style' || tag === 'script')) {
      const closeNeedle = `</${tag}`;
      const closeStart = lower.indexOf(closeNeedle, gtIdx + 1);
      if (closeStart === -1) break;
      const closeEnd = raw.indexOf('>', closeStart + closeNeedle.length);
      pos = closeEnd === -1 ? len : closeEnd + 1;
      lineBuf.text += ' ';
      ltIdx = raw.indexOf('<', pos);
      continue;
    }

    if (tag === 'br') {
      const cleaned = finalizeStructuredLine(lineBuf.text);
      lineBuf.text = '';
      if (cleaned) result.push(cleaned);
    } else if (isClosing) {
      if (tag === 'td' || tag === 'th') {
        lineBuf.text += '\t';
      } else if (tag === 'tr' || tag === 'p' || tag === 'div' || tag === 'li') {
        const cleaned = finalizeStructuredLine(lineBuf.text);
        lineBuf.text = '';
        if (cleaned) result.push(cleaned);
      } else {
        lineBuf.text += ' ';
      }
    } else {
      lineBuf.text += ' ';
    }

    pos = gtIdx + 1;
    ltIdx = raw.indexOf('<', pos);
  }

  if (result.length < MAX_STRUCTURED_LINES && lineBuf.text) {
    const cleaned = finalizeStructuredLine(lineBuf.text);
    if (cleaned) result.push(cleaned);
  }

  return result;
}

function getLabelRegexes(labelPatternStr: string): { exact: RegExp; inline: RegExp } {
  const key = String(labelPatternStr || '');
  let cached = LABEL_REGEX_CACHE.get(key);
  if (cached) return cached;

  const cleanPattern = key.replace(/^\^/, '').replace(/\$$/, '');
  cached = {
    exact: new RegExp(`^(?:${cleanPattern})\\s*[:：]?$`, 'i'),
    inline: new RegExp(`^(?:${cleanPattern})\\s*[:：]?\\s+(.+)$`, 'i'),
  };

  if (LABEL_REGEX_CACHE.size < MAX_LABEL_CACHE_SIZE) {
    LABEL_REGEX_CACHE.set(key, cached);
  }
  return cached;
}

/**
 * Extracts a field value following a label across 3 layouts:
 * 1) Two-column HTML table separated by `\t`
 * 2) Same-line `Label: Value` or `Label Value`
 * 3) Label on line `i`, value on line `i + 1`
 */
export function extractFieldAfterLabel(lines: string[], labelPatternStr: string): string {
  const { exact: exactRegex, inline: inlineRegex } = getLabelRegexes(labelPatternStr);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.includes('\t')) {
      const cols = line
        .split('\t')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length >= 2 && exactRegex.test(cols[0]!)) {
        return cols.slice(1).join(' ').trim();
      }
      if (cols.length === 1 && exactRegex.test(cols[0]!) && i + 1 < lines.length) {
        return lines[i + 1]!.trim();
      }
    }

    const inlineMatch = line.match(inlineRegex);
    if (inlineMatch?.[1]?.trim()) {
      return inlineMatch[1].trim();
    }

    if (exactRegex.test(line) && i + 1 < lines.length) {
      return lines[i + 1]!.trim();
    }
  }
  return '';
}

export function parseVietnameseDateTime(raw?: string, fallbackDate?: string): string {
  const input = String(raw || '').trim();
  if (input) {
    // Format: DD/MM/YYYY HH:mm[:ss] or DD-MM-YYYY HH:mm[:ss]
    const dmyFirst = input.match(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (dmyFirst) {
      const day = dmyFirst[1]!.padStart(2, '0');
      const month = dmyFirst[2]!.padStart(2, '0');
      const year = dmyFirst[3]!;
      const hour = (dmyFirst[4] || '00').padStart(2, '0');
      const minute = (dmyFirst[5] || '00').padStart(2, '0');
      const second = (dmyFirst[6] || '00').padStart(2, '0');
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) return new Date(ms).toISOString();
    }

    // Format: HH:mm[:ss] DD/MM/YYYY
    const timeFirst = input.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?[,\s\-]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/
    );
    if (timeFirst) {
      const hour = timeFirst[1]!.padStart(2, '0');
      const minute = timeFirst[2]!.padStart(2, '0');
      const second = (timeFirst[3] || '00').padStart(2, '0');
      const day = timeFirst[4]!.padStart(2, '0');
      const month = timeFirst[5]!.padStart(2, '0');
      const year = timeFirst[6]!;
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) return new Date(ms).toISOString();
    }

    const directMs = Date.parse(input);
    if (Number.isFinite(directMs)) {
      return new Date(directMs).toISOString();
    }
  }

  if (fallbackDate) {
    const fbMs = Date.parse(fallbackDate);
    if (Number.isFinite(fbMs)) return new Date(fbMs).toISOString();
  }

  return new Date().toISOString();
}
