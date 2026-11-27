const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const SHORT_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers WebCrypto limit is 100,000 iterations

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Constant-time string comparison on UTF-8 bytes without early-return length leak.
 * Returns false if either input is empty or lengths differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = textEncoder.encode(String(a ?? ''));
  const bytesB = textEncoder.encode(String(b ?? ''));
  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < bytesA.length ? bytesA[i]! : 0;
    const byteB = i < bytesB.length ? bytesB[i]! : 0;
    diff |= byteA ^ byteB;
  }
  return maxLen > 0 && diff === 0;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? textEncoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomBase64Url(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function generateShortId(length = 12): string {
  const out: string[] = [];
  const alphabetLen = SHORT_ID_ALPHABET.length; // 57
  const limit = 256 - (256 % alphabetLen); // rejection sampling avoids modulo bias
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const byte = buf[i]!;
      if (byte < limit) {
        out.push(SHORT_ID_ALPHABET[byte % alphabetLen]!);
      }
    }
  }
  return out.join('');
}

export async function generateApiKey(
  prefix: 'cm_live_' | 'cm_test_' = 'cm_live_'
): Promise<{ plaintext: string; keyPrefix: string; keyHash: string }> {
  const secretPart = randomBase64Url(24);
  const plaintext = `${prefix}${secretPart}`;
  const keyPrefix = plaintext.slice(0, prefix.length + 6);
  const keyHash = await sha256Hex(plaintext);
  return { plaintext, keyPrefix, keyHash };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(textEncoder.encode(message)));
  return bytesToHex(new Uint8Array(sig));
}

export async function signWebhookPayload(
  payload: string,
  secret: string,
  timestampSec: number = Math.floor(Date.now() / 1000)
): Promise<{ timestamp: number; signature: string; header: string }> {
  const signature = await hmacSha256Hex(secret, `${timestampSec}.${payload}`);
  return {
    timestamp: timestampSec,
    signature,
    header: `t=${timestampSec},v1=${signature}`,
  };
}

export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  options?: { toleranceSec?: number; nowSec?: number }
): Promise<{ valid: boolean; reason?: string; timestamp?: number }> {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'Missing signature header or secret' };
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of signatureHeader.split(',')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    if (k === 't') {
      const parsed = Number.parseInt(v, 10);
      if (Number.isFinite(parsed) && /^\d+$/.test(v)) {
        timestamp = parsed;
      }
    } else if (k === 'v1' && v) {
      signatures.push(v.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return { valid: false, reason: 'Malformed signature header' };
  }

  const toleranceSec = options?.toleranceSec ?? 300;
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { valid: false, reason: 'Webhook timestamp outside tolerance window', timestamp };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  const matched = signatures.some((sig) => timingSafeEqual(sig, expected));
  if (!matched) {
    return { valid: false, reason: 'Invalid webhook signature', timestamp };
  }

  return { valid: true, timestamp };
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Password cannot be empty');
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256
  );

  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derivedBits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) {
    return false;
  }

  try {
    const salt = base64ToBytes(parts[2]!);
    const expectedHashB64 = parts[3]!;
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(textEncoder.encode(password)),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: toArrayBuffer(salt),
        iterations,
      },
      keyMaterial,
      256
    );
    const derivedB64 = bytesToBase64(new Uint8Array(derivedBits));
    return timingSafeEqual(derivedB64, expectedHashB64);
  } catch {
    return false;
  }
}

const AES_KEY_CACHE_MAX = 16;
const aesKeyCache = new Map<string, Promise<CryptoKey>>();

async function deriveAesKey(masterKey: string): Promise<CryptoKey> {
  if (!masterKey) {
    throw new Error('Master key cannot be empty');
  }
  const cached = aesKeyCache.get(masterKey);
  if (cached) {
    return cached;
  }

  const keyPromise = (async () => {
    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      toArrayBuffer(textEncoder.encode(masterKey))
    );
    return crypto.subtle.importKey(
      'raw',
      hashBuf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  })();

  if (aesKeyCache.size >= AES_KEY_CACHE_MAX) {
    const oldestKey = aesKeyCache.keys().next().value;
    if (oldestKey !== undefined) {
      aesKeyCache.delete(oldestKey);
    }
  }
  aesKeyCache.set(masterKey, keyPromise);

  try {
    return await keyPromise;
  } catch (err) {
    aesKeyCache.delete(masterKey);
    throw err;
  }
}

export async function encryptSecret(plaintext: string, masterKey: string): Promise<string> {
  const key = await deriveAesKey(masterKey);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(textEncoder.encode(plaintext))
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuf))}`;
}

export async function decryptSecret(ciphertext: string, masterKey: string): Promise<string> {
  const parts = String(ciphertext || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format');
  }
  const key = await deriveAesKey(masterKey);
  const iv = base64ToBytes(parts[1]!);
  const data = base64ToBytes(parts[2]!);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data)
  );
  return textDecoder.decode(plainBuf);
}
