const utf8Decoder = new TextDecoder('utf-8');
const MAX_MIME_DEPTH = 16;

export interface ParsedMimeEmail {
  headers: Record<string, string[]>;
  from: string;
  to?: string;
  subject?: string;
  date?: string;
  messageId?: string;
  textBody?: string;
  htmlBody?: string;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64ToBytes(input: string): Uint8Array {
  if (!input) return new Uint8Array(0);
  // Fast path: WHATWG atob() natively ignores ASCII whitespace (\r, \n, space, \t),
  // avoiding an expensive regex copy on 100KB+ MIME base64 bodies.
  try {
    return binaryStringToBytes(atob(input));
  } catch {
    const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '');
    if (!cleaned) return new Uint8Array(0);
    try {
      return binaryStringToBytes(atob(cleaned));
    } catch {
      // Gracefully tolerate unpadded or malformed base64 without crashing Worker
      const stripped = cleaned.replace(/=+$/g, '');
      const rem = stripped.length % 4;
      if (rem === 1) return new Uint8Array(0);
      const padded = rem === 0 ? stripped : stripped + '='.repeat(4 - rem);
      try {
        return binaryStringToBytes(atob(padded));
      } catch {
        return new Uint8Array(0);
      }
    }
  }
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 65 && code <= 70) return code - 55; // A-F
  if (code >= 97 && code <= 102) return code - 87; // a-f
  return -1;
}

function decodeQuotedPrintableToBytes(input: string): Uint8Array {
  // Remove soft line breaks `=\r\n` or `=\n`
  const unwrapped = input.replace(/=(?:\r\n|\r|\n)/g, '');
  const out = new Uint8Array(unwrapped.length);
  let writeIdx = 0;
  for (let i = 0; i < unwrapped.length; i++) {
    const ch = unwrapped.charCodeAt(i);
    if (ch === 61 /* '=' */ && i + 2 < unwrapped.length) {
      const hi = hexNibble(unwrapped.charCodeAt(i + 1));
      const lo = hexNibble(unwrapped.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out[writeIdx++] = (hi << 4) | lo;
        i += 2;
        continue;
      }
    }
    out[writeIdx++] = ch & 0xff;
  }
  return out.subarray(0, writeIdx);
}

function decodeBytesWithCharset(bytes: Uint8Array, charset = 'utf-8'): string {
  const norm = charset.trim().toLowerCase();
  if (!norm || norm === 'utf-8' || norm === 'utf8') {
    return utf8Decoder.decode(bytes);
  }
  try {
    return new TextDecoder(norm).decode(bytes);
  } catch {
    return utf8Decoder.decode(bytes);
  }
}

function decodeRfc2047Word(encoded: string): string {
  return encoded.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return decodeBytesWithCharset(decodeBase64ToBytes(text), charset);
      }
      // RFC 2047 Q-encoding treats '_' as space
      const qp = text.replace(/_/g, ' ');
      return decodeBytesWithCharset(decodeQuotedPrintableToBytes(qp), charset);
    } catch {
      return text;
    }
  });
}

function parseHeaderBlock(rawHeaderBlock: string): Record<string, string[]> {
  const unfolded = rawHeaderBlock.replace(/\r?\n([ \t]+)/g, ' ');
  const headers: Record<string, string[]> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const name = line.slice(0, colonIdx).trim().toLowerCase();
    const rawVal = line.slice(colonIdx + 1).trim();
    const value = decodeRfc2047Word(rawVal);
    if (!headers[name]) headers[name] = [];
    headers[name]!.push(value);
  }
  return headers;
}

function getFirstHeader(headers: Record<string, string[]>, name: string): string | undefined {
  return headers[name.toLowerCase()]?.[0];
}

function extractParam(headerVal: string, paramName: string): string | undefined {
  const regex = new RegExp(`(?:^|;)\\s*${paramName}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, 'i');
  const match = headerVal.match(regex);
  return (match?.[1] || match?.[2] || '').trim() || undefined;
}

function decodePartBody(rawBody: string, transferEncoding: string | undefined, charset: string | undefined): string {
  const enc = (transferEncoding || '').trim().toLowerCase();
  if (enc === 'base64') {
    return decodeBytesWithCharset(decodeBase64ToBytes(rawBody), charset);
  }
  if (enc === 'quoted-printable') {
    return decodeBytesWithCharset(decodeQuotedPrintableToBytes(rawBody), charset);
  }
  if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'us-ascii') {
    const bytes = new Uint8Array(rawBody.length);
    for (let i = 0; i < rawBody.length; i++) {
      bytes[i] = rawBody.charCodeAt(i) & 0xff;
    }
    return decodeBytesWithCharset(bytes, charset);
  }
  return rawBody;
}

function splitEntity(rawEntity: string): { headers: Record<string, string[]>; body: string } {
  const match = rawEntity.match(/\r?\n\r?\n/);
  if (!match || match.index === undefined) {
    return { headers: parseHeaderBlock(rawEntity), body: '' };
  }
  const headerBlock = rawEntity.slice(0, match.index);
  const body = rawEntity.slice(match.index + match[0].length);
  return { headers: parseHeaderBlock(headerBlock), body };
}

function collectBodyParts(
  headers: Record<string, string[]>,
  body: string,
  acc: { textParts: string[]; htmlParts: string[] },
  depth = 0
): void {
  if (depth >= MAX_MIME_DEPTH) return;

  const contentType = getFirstHeader(headers, 'content-type') || 'text/plain; charset=utf-8';
  const mimeType = (contentType.split(';')[0] || 'text/plain').trim().toLowerCase();

  if (mimeType.startsWith('multipart/')) {
    const boundary = extractParam(contentType, 'boundary');
    if (!boundary) return;

    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundaryRegex = new RegExp(`(?:^|\\r?\\n)--${escaped}(--)?[ \\t]*(?:\\r?\\n|$)`, 'g');
    const matches: Array<{ index: number; len: number; isClosing: boolean }> = [];
    let m: RegExpExecArray | null;
    while ((m = boundaryRegex.exec(body)) !== null) {
      matches.push({
        index: m.index,
        len: m[0].length,
        isClosing: m[1] === '--',
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]!;
      if (current.isClosing) break;
      const next = matches[i + 1];
      const partStart = current.index + current.len;
      const partEnd = next ? next.index : body.length;
      const rawPart = body.slice(partStart, partEnd);
      if (!rawPart.trim()) continue;
      const parsedPart = splitEntity(rawPart);
      collectBodyParts(parsedPart.headers, parsedPart.body, acc, depth + 1);
    }
    return;
  }

  const transferEncoding = getFirstHeader(headers, 'content-transfer-encoding');
  const charset = extractParam(contentType, 'charset') || 'utf-8';
  const decoded = decodePartBody(body, transferEncoding, charset);

  if (mimeType === 'text/html') {
    acc.htmlParts.push(decoded);
  } else if (mimeType === 'text/plain') {
    acc.textParts.push(decoded);
  }
}

export function parseRawMimeEmail(rawMime: string): ParsedMimeEmail {
  const root = splitEntity(rawMime);
  const acc = { textParts: [] as string[], htmlParts: [] as string[] };
  collectBodyParts(root.headers, root.body, acc);

  return {
    headers: root.headers,
    from: getFirstHeader(root.headers, 'from') || '',
    to: getFirstHeader(root.headers, 'to'),
    subject: getFirstHeader(root.headers, 'subject'),
    date: getFirstHeader(root.headers, 'date'),
    messageId: getFirstHeader(root.headers, 'message-id'),
    textBody: acc.textParts.length > 0 ? acc.textParts.join('\n') : undefined,
    htmlBody: acc.htmlParts.length > 0 ? acc.htmlParts.join('\n') : undefined,
  };
}
