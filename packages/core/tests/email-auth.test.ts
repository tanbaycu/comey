import { describe, expect, it } from 'vitest';
import {
  detectGmailForwardingConfirmation,
  domainMatchesAllowed,
  extractDomain,
  extractEmailAddress,
  parseAuthenticationResults,
  verifyBankEmailAuth,
} from '../src/index.js';

describe('Email Anti-Spoofing & Domain Alignment', () => {
  it('matches exact and strict subdomain only (rejects lookalike domains)', () => {
    expect(domainMatchesAllowed('cake.vn', ['cake.vn'])).toBe(true);
    expect(domainMatchesAllowed('mail.cake.vn', ['cake.vn'])).toBe(true);
    expect(domainMatchesAllowed('evilcake.vn', ['cake.vn'])).toBe(false);
    expect(domainMatchesAllowed('cake.vn.attacker.com', ['cake.vn'])).toBe(false);
    expect(extractDomain('Cake <no-reply@MAIL.CAKE.VN>')).toBe('mail.cake.vn');
  });

  it('strictly extracts RFC 5322 email outside quoted display names and comments', () => {
    expect(extractEmailAddress('"Fake <no-reply@cake.vn>" <attacker@evil.com>')).toBe(
      'attacker@evil.com'
    );
    expect(extractDomain('"Fake <no-reply@cake.vn>" <attacker@evil.com>')).toBe('evil.com');
    expect(extractEmailAddress('"Evil \\"<no-reply@cake.vn>\\"" <attacker@evil.com>')).toBe(
      'attacker@evil.com'
    );
    expect(extractEmailAddress('Fake (no-reply@cake.vn) <attacker@evil.com>')).toBe(
      'attacker@evil.com'
    );
    expect(extractEmailAddress('no-reply@cake.vn <attacker@evil.com>')).toBe('attacker@evil.com');
    expect(extractEmailAddress('"no-reply@cake.vn"')).toBeNull();
    expect(extractEmailAddress('shopowner+caf_=acc_demo=in.comey.vn@gmail.com')).toBe(
      'shopowner+caf_=acc_demo=in.comey.vn@gmail.com'
    );
  });

  it('verifies direct Authentication-Results with aligned DKIM=pass', () => {
    const res = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'Cake <no-reply@cake.vn>',
        authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=cake.vn; spf=pass; dmarc=pass',
      },
      ['cake.vn']
    );
    expect(res.status).toBe('verified');
    expect(res.dkimPass).toBe(true);
    expect(res.dkimDomain).toBe('cake.vn');
    expect(res.spfPass).toBe(true);
    expect(res.dmarcPass).toBe(true);
  });

  it('inspects only the topmost Authentication-Results header and fails closed on dkim=fail', () => {
    // Forged lower header MUST NOT override an upper MTA failure
    const dualHeaderRes = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        headers: {
          'authentication-results': [
            'mx.cloudflare.net; dkim=fail header.d=cake.vn; spf=fail',
            'forged.mx; dkim=pass header.d=cake.vn; spf=pass; dmarc=pass',
          ],
        },
      },
      ['cake.vn']
    );
    expect(dualHeaderRes.status).toBe('spoof_suspected');
    expect(dualHeaderRes.dkimPass).toBe(false);
    expect(dualHeaderRes.dkimDomain).toBeNull();

    // Even inside the same header, explicit dkim=fail MUST fail closed before dkim=pass
    const mixedSameHeader = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        authenticationResults:
          'mx.cloudflare.net; dkim=pass header.d=cake.vn; dkim=fail header.d=cake.vn',
      },
      ['cake.vn']
    );
    expect(mixedSameHeader.status).toBe('spoof_suspected');
    expect(mixedSameHeader.dkimPass).toBe(false);

    // Optional trustedAuthservIds filters untrusted topmost authserv-id
    const parsedUntrusted = parseAuthenticationResults(
      ['forged.mx; dkim=pass header.d=cake.vn; spf=pass'],
      { trustedAuthservIds: ['cloudflare.net'] }
    );
    expect(parsedUntrusted.dkimResults).toHaveLength(0);
    expect(parsedUntrusted.spfPass).toBe(false);

    const parsedTrusted = parseAuthenticationResults(
      ['mx.cloudflare.net; dkim=pass header.d=cake.vn; spf=pass'],
      { trustedAuthservIds: ['cloudflare.net'] }
    );
    expect(parsedTrusted.dkimResults).toHaveLength(1);
    expect(parsedTrusted.spfPass).toBe(true);
  });

  it('accepts forwarded mail when ARC passes with a trusted ARC-Seal domain (google.com)', () => {
    const res = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        headers: {
          'authentication-results': 'mx.cloudflare.net; arc=pass; spf=pass smtp.mailfrom=gmail.com',
          'arc-seal':
            'i=1; a=rsa-sha256; t=1700000000; cv=none; d=google.com; s=arc-20240605; b=sig',
          'arc-authentication-results': 'i=1; mx.google.com; dkim=pass header.d=cake.vn; dmarc=pass',
        },
      },
      ['cake.vn']
    );
    expect(res.status).toBe('verified');
    expect(res.arcPass).toBe(true);
    expect(res.dkimPass).toBe(true);
    expect(res.dkimDomain).toBe('cake.vn');
  });

  it('rejects untrusted or missing ARC-Seal chains even when arc=pass appears', () => {
    // Missing ARC-Seal
    const missingSeal = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        headers: {
          'authentication-results': 'mx.cloudflare.net; arc=pass',
          'arc-authentication-results': 'i=1; mx.google.com; dkim=pass header.d=cake.vn',
        },
      },
      ['cake.vn']
    );
    expect(missingSeal.status).not.toBe('verified');
    expect(missingSeal.dkimPass).toBe(false);
    expect(missingSeal.arcPass).toBe(false);

    // Self-signed attacker ARC chain
    const attackerArc = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        headers: {
          'authentication-results': 'mx.cloudflare.net; arc=pass',
          'arc-seal': 'i=1; a=rsa-sha256; t=1700000000; cv=none; d=attacker.com; s=s1; b=sig',
          'arc-authentication-results': 'i=1; mx.attacker.com; dkim=pass header.d=cake.vn',
        },
      },
      ['cake.vn']
    );
    expect(attackerArc.status).not.toBe('verified');
    expect(attackerArc.dkimPass).toBe(false);

    // Multi-hop: attacker forged i=1, Google added i=2 with dkim=fail
    const multiHopSpoof = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        headers: {
          'authentication-results': 'mx.cloudflare.net; arc=pass',
          'arc-seal': [
            'i=2; a=rsa-sha256; cv=pass; d=google.com; s=arc-20240605; b=sig2',
            'i=1; a=rsa-sha256; cv=none; d=attacker.com; s=s1; b=sig1',
          ],
          'arc-authentication-results': [
            'i=2; mx.google.com; dkim=fail header.d=cake.vn',
            'i=1; mx.attacker.com; dkim=pass header.d=cake.vn',
          ],
        },
      },
      ['cake.vn']
    );
    expect(multiHopSpoof.status).toBe('spoof_suspected');
    expect(multiHopSpoof.dkimPass).toBe(false);
  });

  it('flags spoof_suspected when DKIM fails or signs with attacker domain', () => {
    const unaligned = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=phish.xyz',
      },
      ['cake.vn']
    );
    expect(unaligned.status).toBe('spoof_suspected');
    expect(unaligned.dkimPass).toBe(false);

    const failed = verifyBankEmailAuth(
      {
        source: 'email_worker',
        from: 'no-reply@cake.vn',
        authenticationResults: 'mx.cloudflare.net; dkim=fail header.d=cake.vn',
      },
      ['cake.vn']
    );
    expect(failed.status).toBe('spoof_suspected');
  });

  it('returns unverified when Authentication-Results headers are missing and simulated for simulator', () => {
    const missing = verifyBankEmailAuth(
      { source: 'apps_script', from: 'no-reply@cake.vn' },
      ['cake.vn']
    );
    expect(missing.status).toBe('unverified');

    const sim = verifyBankEmailAuth(
      { source: 'simulator', from: 'no-reply@cake.vn' },
      ['cake.vn']
    );
    expect(sim.status).toBe('simulated');
    expect(sim.dkimPass).toBe(true);
  });

  it('fails closed on Gmail forwarding confirmation when DKIM is missing, failed, or spoofed', () => {
    const baseBody =
      'shopowner@gmail.com has requested to automatically forward mail.\nConfirmation code: 482910374\nhttps://mail-settings.google.com/mail/vf-abc';

    // Missing Authentication-Results MUST NOT fail open
    const missingAuth = detectGmailForwardingConfirmation({
      source: 'email_worker',
      from: 'Gmail Team <forwarding-noreply@google.com>',
      subject: 'Gmail Forwarding Confirmation',
      textBody: baseBody,
    });
    expect(missingAuth.isForwardingConfirmation).toBe(false);

    // Spoofed display-name From header
    const spoofedDisplay = detectGmailForwardingConfirmation({
      source: 'email_worker',
      from: '"Gmail <forwarding-noreply@google.com>" <attacker@evil.com>',
      subject: 'Gmail Forwarding Confirmation',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=google.com',
      textBody: baseBody,
    });
    expect(spoofedDisplay.isForwardingConfirmation).toBe(false);

    // Simulator source MUST NOT pass forwarding confirmation
    const simSource = detectGmailForwardingConfirmation({
      source: 'simulator',
      from: 'Gmail Team <forwarding-noreply@google.com>',
      subject: 'Gmail Forwarding Confirmation',
      textBody: baseBody,
    });
    expect(simSource.isForwardingConfirmation).toBe(false);

    // Valid google.com DKIM=pass succeeds
    const valid = detectGmailForwardingConfirmation({
      source: 'email_worker',
      from: 'Gmail Team <forwarding-noreply@google.com>',
      subject: 'Gmail Forwarding Confirmation',
      authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=google.com; spf=pass',
      textBody: baseBody,
    });
    expect(valid.isForwardingConfirmation).toBe(true);
    expect(valid.confirmationCode).toBe('482910374');
  });
});
