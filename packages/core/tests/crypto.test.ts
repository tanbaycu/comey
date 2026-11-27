import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateShortId,
  hashPassword,
  sha256Hex,
  signWebhookPayload,
  timingSafeEqual,
  verifyPassword,
  verifyWebhookSignature,
} from '../src/index.js';

describe('WebCrypto Security Utilities', () => {
  it('signs and verifies HMAC-SHA256 webhook payloads with replay protection', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'session.paid', amount: 80000 });
    const secret = 'whsec_test_secret_123456';
    const nowSec = 1_700_000_000;

    const signed = await signWebhookPayload(payload, secret, nowSec);
    const ok = await verifyWebhookSignature(payload, signed.header, secret, {
      nowSec: nowSec + 30,
      toleranceSec: 300,
    });
    expect(ok.valid).toBe(true);
    expect(ok.timestamp).toBe(nowSec);

    const tampered = await verifyWebhookSignature(
      payload.replace('80000', '999999'),
      signed.header,
      secret,
      { nowSec: nowSec + 30 }
    );
    expect(tampered.valid).toBe(false);

    const expired = await verifyWebhookSignature(payload, signed.header, secret, {
      nowSec: nowSec + 600,
      toleranceSec: 300,
    });
    expect(expired.valid).toBe(false);
    expect(expired.reason).toContain('tolerance');
  });

  it('hashes and verifies passwords using Workers-compatible 100k PBKDF2', async () => {
    const hash = await hashPassword('StrongPass!2026');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('StrongPass!2026', hash)).toBe(true);
    expect(await verifyPassword('WrongPass!2026', hash)).toBe(false);
  });

  it('encrypts and decrypts webhook secrets via AES-256-GCM', async () => {
    const master = 'master_key_32_bytes_for_aes_gcm!';
    const encrypted = await encryptSecret('whsec_my_secret_value', master);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted).not.toContain('whsec_my_secret_value');

    const decrypted = await decryptSecret(encrypted, master);
    expect(decrypted).toBe('whsec_my_secret_value');

    // Repeated encrypt/decrypt exercises bounded memoized AES CryptoKey cache across many keys
    for (let i = 0; i < 20; i++) {
      const k = `master_key_rotation_${i}`;
      const enc = await encryptSecret(`val_${i}`, k);
      expect(await decryptSecret(enc, k)).toBe(`val_${i}`);
    }

    await expect(decryptSecret(encrypted, 'wrong_master_key')).rejects.toThrow();
  });

  it('generates API keys, short IDs, hashes, and constant-time equality', async () => {
    const apiKey = await generateApiKey('cm_live_');
    expect(apiKey.plaintext.startsWith('cm_live_')).toBe(true);
    expect(apiKey.keyHash).toBe(await sha256Hex(apiKey.plaintext));
    expect(generateShortId(12)).toHaveLength(12);
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('abc', 'abc\0')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(false);
  });
});
