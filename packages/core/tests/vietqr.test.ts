import { describe, expect, it } from 'vitest';
import {
  BANK_CATALOG,
  createVietQR,
  generateQrPngBytes,
  generateQrSvgMarkup,
  generateVietQREMVCo,
  sanitizeTransferNote,
} from '../src/index.js';

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

function inspectStoredPng(png: Uint8Array): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  rawImageBytes: Uint8Array;
} {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (pos + 12 <= png.length) {
    const len = readUint32BE(png, pos);
    const type = String.fromCharCode(
      png[pos + 4]!,
      png[pos + 5]!,
      png[pos + 6]!,
      png[pos + 7]!
    );
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = readUint32BE(data, 0);
      height = readUint32BE(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }
    pos += 12 + len;
  }

  const totalZlib = idatChunks.reduce((acc, c) => acc + c.length, 0);
  const zlib = new Uint8Array(totalZlib);
  let zOff = 0;
  for (const c of idatChunks) {
    zlib.set(c, zOff);
    zOff += c.length;
  }

  // Decode uncompressed DEFLATE stored blocks inside zlib stream (skip 2B header and 4B Adler32)
  const rawParts: Uint8Array[] = [];
  let p = 2;
  const end = zlib.length - 4;
  while (p < end) {
    const header = zlib[p++]!;
    const len = zlib[p]! | (zlib[p + 1]! << 8);
    const nlen = zlib[p + 2]! | (zlib[p + 3]! << 8);
    expect((len ^ nlen) & 0xffff).toBe(0xffff);
    p += 4;
    rawParts.push(zlib.subarray(p, p + len));
    p += len;
    if ((header & 1) === 1) break;
  }

  const totalRaw = rawParts.reduce((acc, c) => acc + c.length, 0);
  const rawImageBytes = new Uint8Array(totalRaw);
  let rOff = 0;
  for (const part of rawParts) {
    rawImageBytes.set(part, rOff);
    rOff += part.length;
  }

  return { width, height, bitDepth, colorType, rawImageBytes };
}

describe('VietQR EMVCo & In-Memory QR Renderer', () => {
  it('sanitizes Vietnamese diacritics and special characters safely', () => {
    expect(sanitizeTransferNote('Đơn hàng #123 — Nguyễn Văn Á!')).toBe('Don hang 123 Nguyen Van A');
  });

  it('generates valid EMVCo NAPAS 247 payload with CRC16 checksum', () => {
    const emvco = generateVietQREMVCo({
      bankBin: BANK_CATALOG.CAKE.bin,
      accountNumber: '0835117727',
      amount: 80000,
      transferNote: 'MUA950961',
    });

    expect(emvco.startsWith('000201010212')).toBe(true);
    expect(emvco).toContain('A000000727');
    expect(emvco).toContain('546034');
    expect(emvco).toContain('0835117727');
    expect(emvco).toContain('5303704');
    expect(emvco).toContain('540580000');
    expect(emvco).toContain('5802VN');
    expect(emvco).toContain('MUA950961');
    expect(emvco).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('renders crisp SVG and valid 1-bit PNG in memory without external APIs', () => {
    const qr = createVietQR({
      bankBin: BANK_CATALOG.SACOMBANK.bin,
      accountNumber: '060350843976',
      amount: 50000,
      transferNote: 'NAP123456',
    });

    expect(qr.svg.startsWith('<svg ')).toBe(true);
    expect(qr.svg).toContain('<path fill="#141414"');
    expect(qr.svg.endsWith('</svg>')).toBe(true);

    const png = qr.toPngBytes();
    expect(png.length).toBeGreaterThan(500);
    // PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('produces spec-compliant 1-bit PNG scanline widths for any scale value', () => {
    const payload = generateVietQREMVCo({
      bankBin: BANK_CATALOG.CAKE.bin,
      accountNumber: '0835117727',
      amount: 50000,
      transferNote: 'SCALECHECK',
    });

    for (const scale of [1, 3, 4, 5, 7, 8, 10]) {
      const png = generateQrPngBytes(payload, { margin: 2, scale });
      const info = inspectStoredPng(png);
      expect(info.width).toBe(info.height);
      expect(info.width % scale).toBe(0);
      expect(info.bitDepth).toBe(1);
      expect(info.colorType).toBe(0);

      const expectedRowBytes = 1 + Math.ceil(info.width / 8);
      expect(info.rawImageBytes.length).toBe(info.height * expectedRowBytes);

      // Every scanline must start with filter byte 0x00 and top margin row must be white (1-bits)
      for (let y = 0; y < info.height; y++) {
        expect(info.rawImageBytes[y * expectedRowBytes]).toBe(0x00);
      }
      expect(info.rawImageBytes[1]).toBe(0xff);
    }
  });

  it('escapes XML attribute values in generateQrSvgMarkup and supports large payloads', () => {
    const svg = generateQrSvgMarkup('HELLO-QR', {
      ariaLabel: 'Pay "100" <script>&\'xss\'',
      darkColor: '#000" onload="alert(1)',
      lightColor: '#fff"><script>alert(2)</script>',
    });

    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('onload="alert(1)"');
    expect(svg).toContain('aria-label="Pay &quot;100&quot; &lt;script&gt;&amp;&#39;xss&#39;"');
    expect(svg).toContain('fill="#000&quot; onload=&quot;alert(1)"');
    expect(svg).toContain('fill="#fff&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"');

    // Longer UTF-8 payload crossing version 10+ boundary
    const longSvg = generateQrSvgMarkup('A'.repeat(240));
    expect(longSvg.startsWith('<svg ')).toBe(true);
    expect(longSvg.endsWith('</svg>')).toBe(true);
  });
});
