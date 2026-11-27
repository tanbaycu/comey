import qrcode from 'qrcode-generator';
import { generateVietQREMVCo, type VietQRInput } from './vietqr.js';

type QrFactory = (typeNumber: TypeNumber, errorCorrectionLevel: ErrorCorrectionLevel) => QRCode;

const createQr: QrFactory =
  typeof qrcode === 'function'
    ? (qrcode as unknown as QrFactory)
    : ((qrcode as unknown as { default: QrFactory }).default);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const len = buf.length;
  let i = 0;
  while (i < len) {
    const end = Math.min(i + 5552, len);
    while (i < end) {
      s1 += buf[i++]!;
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function writeUint32BE(out: Uint8Array, offset: number, val: number): void {
  out[offset] = (val >>> 24) & 0xff;
  out[offset + 1] = (val >>> 16) & 0xff;
  out[offset + 2] = (val >>> 8) & 0xff;
  out[offset + 3] = val & 0xff;
}

function makePngChunk(typeAscii: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = typeAscii.charCodeAt(i) & 0xff;
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

const textEncoder = new TextEncoder();

// ISO/IEC 18004 Byte-mode capacities for ECC level 'M', QR versions 1..40.
const QR_BYTE_CAPACITY_M: readonly number[] = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
  251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370,
  1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
];

function resolveMinQrTypeNumberM(payloadText: string): TypeNumber {
  const byteLength = textEncoder.encode(payloadText).length;
  for (let i = 0; i < QR_BYTE_CAPACITY_M.length; i++) {
    if (byteLength <= QR_BYTE_CAPACITY_M[i]!) {
      return (i + 1) as TypeNumber;
    }
  }
  return 0;
}

function buildQrMatrix(payloadText: string): QRCode {
  const version = resolveMinQrTypeNumberM(payloadText);
  if (version > 0) {
    try {
      const qr = createQr(version, 'M');
      qr.addData(payloadText);
      qr.make();
      return qr;
    } catch {
      // Safe fallback to auto-detection if a payload unexpectedly overflows the precomputed version
    }
  }
  const fallbackQr = createQr(0, 'M');
  fallbackQr.addData(payloadText);
  fallbackQr.make();
  return fallbackQr;
}

function escapeXmlAttr(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderQrPngFromMatrix(
  qr: QRCode,
  options?: { margin?: number; scale?: number }
): Uint8Array {
  const modules = qr.getModuleCount();
  const margin = Math.max(0, Math.floor(options?.margin ?? 4));
  const totalModules = modules + margin * 2;
  const scale = Math.max(1, Math.floor(options?.scale ?? 8));
  const size = totalModules * scale;
  const bytesPerRow = Math.ceil(size / 8);
  const rowByteLen = 1 + bytesPerRow;
  const rawLen = size * rowByteLen;

  const raw = new Uint8Array(rawLen);
  const moduleRowBuf = new Uint8Array(rowByteLen);

  let dstOffset = 0;
  for (let mr = 0; mr < totalModules; mr++) {
    const qrRow = mr - margin;
    const inBoundsRow = qrRow >= 0 && qrRow < modules;

    if (scale === 8) {
      moduleRowBuf[0] = 0x00;
      for (let mc = 0; mc < totalModules; mc++) {
        const qrCol = mc - margin;
        const isDark =
          inBoundsRow && qrCol >= 0 && qrCol < modules ? qr.isDark(qrRow, qrCol) : false;
        moduleRowBuf[1 + mc] = isDark ? 0x00 : 0xff;
      }
    } else {
      moduleRowBuf.fill(0);
      for (let mc = 0; mc < totalModules; mc++) {
        const qrCol = mc - margin;
        const isDark =
          inBoundsRow && qrCol >= 0 && qrCol < modules ? qr.isDark(qrRow, qrCol) : false;
        if (!isDark) {
          const pxStart = mc * scale;
          const pxEnd = pxStart + scale;
          for (let px = pxStart; px < pxEnd; px++) {
            moduleRowBuf[1 + (px >>> 3)]! |= 0x80 >>> (px & 7);
          }
        }
      }
    }

    for (let s = 0; s < scale; s++) {
      raw.set(moduleRowBuf, dstOffset);
      dstOffset += rowByteLen;
    }
  }

  const MAX_BLOCK = 65535;
  const blockCount = Math.ceil(rawLen / MAX_BLOCK) || 1;
  const zlibData = new Uint8Array(2 + blockCount * 5 + rawLen + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;

  let zPos = 2;
  let rPos = 0;
  for (let b = 0; b < blockCount; b++) {
    const isLast = b === blockCount - 1;
    const chunkLen = isLast ? rawLen - rPos : MAX_BLOCK;
    const nlen = ~chunkLen & 0xffff;
    zlibData[zPos++] = isLast ? 0x01 : 0x00;
    zlibData[zPos++] = chunkLen & 0xff;
    zlibData[zPos++] = (chunkLen >>> 8) & 0xff;
    zlibData[zPos++] = nlen & 0xff;
    zlibData[zPos++] = (nlen >>> 8) & 0xff;
    zlibData.set(raw.subarray(rPos, rPos + chunkLen), zPos);
    zPos += chunkLen;
    rPos += chunkLen;
  }
  writeUint32BE(zlibData, zPos, adler32(raw));

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, size);
  writeUint32BE(ihdrData, 4, size);
  ihdrData[8] = 1;
  ihdrData[9] = 0;

  const ihdr = makePngChunk('IHDR', ihdrData);
  const idat = makePngChunk('IDAT', zlibData);
  const iend = makePngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length);
  let p = 0;
  png.set(sig, p);
  p += sig.length;
  png.set(ihdr, p);
  p += ihdr.length;
  png.set(idat, p);
  p += idat.length;
  png.set(iend, p);
  return png;
}

function renderQrSvgFromMatrix(
  qr: QRCode,
  options?: { darkColor?: string; lightColor?: string; ariaLabel?: string }
): string {
  const darkColor = escapeXmlAttr(options?.darkColor ?? '#141414');
  const ariaLabel = escapeXmlAttr(options?.ariaLabel ?? 'VietQR');
  const lightRect = options?.lightColor
    ? `<rect width="100%" height="100%" fill="${escapeXmlAttr(options.lightColor)}"/>`
    : '';

  const modules = qr.getModuleCount();
  const pathParts: string[] = [];
  for (let r = 0; r < modules; r++) {
    let c = 0;
    while (c < modules) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < modules && qr.isDark(r, c)) c++;
      const runLen = c - start;
      pathParts.push(`M${start} ${r}h${runLen}v1h-${runLen}z`);
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules} ${modules}" shape-rendering="crispEdges" role="img" aria-label="${ariaLabel}">` +
    lightRect +
    `<path fill="${darkColor}" d="${pathParts.join('')}"/>` +
    `</svg>`
  );
}

export function generateQrPngBytes(
  payloadText: string,
  options?: { margin?: number; scale?: number }
): Uint8Array {
  return renderQrPngFromMatrix(buildQrMatrix(payloadText), options);
}

export function generateQrSvgMarkup(
  text: string,
  options?: { darkColor?: string; lightColor?: string; ariaLabel?: string }
): string {
  return renderQrSvgFromMatrix(buildQrMatrix(text), options);
}

export function createVietQR(
  input: VietQRInput & { darkColor?: string; lightColor?: string }
): {
  emvco: string;
  svg: string;
  toPngBytes: (opts?: { margin?: number; scale?: number }) => Uint8Array;
} {
  const emvco = generateVietQREMVCo(input);
  const qr = buildQrMatrix(emvco);
  const svg = renderQrSvgFromMatrix(qr, {
    darkColor: input.darkColor,
    lightColor: input.lightColor,
  });
  return {
    emvco,
    svg,
    toPngBytes: (opts) => renderQrPngFromMatrix(qr, opts),
  };
}
