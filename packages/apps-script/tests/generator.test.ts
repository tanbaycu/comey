import { describe, expect, it } from 'vitest';
import { generateAppsScriptCode } from '../src/index.js';

describe('@comey/apps-script Generator', () => {
  it('generates valid cloud_bridge Apps Script reading Authentication-Results', () => {
    const code = generateAppsScriptCode({
      mode: 'cloud_bridge',
      ingestUrl: 'https://api.comey.dev/v1/ingest/apps-script',
      expectedAccountNo: '0835-117-727',
      bankDomains: ['cake.vn'],
    });

    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('0835117727');
    expect(code).toContain('Authentication-Results');
    expect(code).toContain('ARC-Authentication-Results');
    expect(code).toContain('LockService.getScriptLock()');
    expect(code).toContain('PROCESSED_MSG_IDS');
    expect(code).toContain('doPost(e)');
    expect(code).toContain('buildBridgePayload_');
  });

  it('generates valid standalone Apps Script with local DKIM check and Cake parser', () => {
    const code = generateAppsScriptCode({
      mode: 'standalone',
      ingestUrl: "https://my-bot.example.com/webhook?tag='test'",
      expectedAccountNo: '0835117727',
      processedLabel: 'Bot_Done',
    });

    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('verifyDkimHeader_');
    expect(code).toContain('parseCakeStandalone_');
    expect(code).toContain('Bot_Done');
  });

  it('wraps multi-domain Gmail search query in parentheses and executes cleanly in a mocked GAS runtime', () => {
    const code = generateAppsScriptCode({
      mode: 'standalone',
      ingestUrl: 'https://api.comey.dev/v1/ingest/apps-script',
      expectedAccountNo: '0835117727',
      bankDomains: ['cake.vn', 'timo.vn'],
      inlineSecret: 'sec_test_123',
    });

    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('"(from:cake.vn OR from:timo.vn)"');

    const capturedQueries: string[] = [];
    const postedPayloads: Array<Record<string, unknown>> = [];
    const propsStore: Record<string, string> = {};

    const makeMsg = (opts: {
      id: string;
      from: string;
      auth: string;
      body: string;
      arcSeal?: string;
    }) => ({
      getId: () => opts.id,
      getFrom: () => opts.from,
      getTo: () => 'merchant@gmail.com',
      getSubject: () => 'Thông báo biến động số dư',
      getDate: () => new Date(),
      getBody: () => opts.body,
      getPlainBody: () => '',
      markRead: () => {},
      getHeader: (name: string) => {
        if (name === 'Authentication-Results') return opts.auth;
        if (name === 'ARC-Seal') return opts.arcSeal ?? '';
        return '';
      },
    });

    const mockMessages = [
      // 1. Spoofed display name -> skipped
      makeMsg({
        id: 'm_spoof_from',
        from: '"Fake <no-reply@cake.vn>" <evil@attacker.com>',
        auth: 'mx.google.com; dkim=pass header.d=cake.vn',
        body: '<table><tr><td>Tài khoản nhận</td><td>0835117727</td></tr><tr><td>Số tiền</td><td>+50.000 đ</td></tr><tr><td>Mã giao dịch</td><td>FTSPOOF1</td></tr></table>',
      }),
      // 2. Explicit dkim=fail -> skipped
      makeMsg({
        id: 'm_dkim_fail',
        from: 'no-reply@cake.vn',
        auth: 'mx.google.com; dkim=fail header.d=cake.vn; dkim=pass header.d=cake.vn',
        body: '<table><tr><td>Tài khoản nhận</td><td>0835117727</td></tr><tr><td>Số tiền</td><td>+50.000 đ</td></tr><tr><td>Mã giao dịch</td><td>FTFAIL01</td></tr></table>',
      }),
      // 3. Substring account mismatch -> skipped
      makeMsg({
        id: 'm_sub_acc',
        from: 'no-reply@cake.vn',
        auth: 'mx.google.com; dkim=pass header.d=cake.vn',
        body: '<table><tr><td>Tài khoản nhận</td><td>108351177279</td></tr><tr><td>Số tiền</td><td>+50.000 đ</td></tr><tr><td>Mã giao dịch</td><td>FTSUB001</td></tr></table>',
      }),
      // 4. Genuine email with trailing fee in Số tiền -> parsed as 50000 (not 500000)
      makeMsg({
        id: 'm_good_fee',
        from: 'Cake <no-reply@cake.vn>',
        auth: 'mx.google.com; dkim=pass header.d=cake.vn',
        body: '<table><tr><td>Tài khoản nhận</td><td>0835117727 - TK TT</td></tr><tr><td>Số tiền</td><td>+50.000 đ (Phí: 0 đ)</td></tr><tr><td>Mã giao dịch</td><td>FTGOOD01</td></tr><tr><td>Nội dung giao dịch</td><td>SHOP100200</td></tr></table>',
      }),
    ];

    const sandboxGlobals = {
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => propsStore[k] ?? null,
          setProperty: (k: string, v: string) => {
            propsStore[k] = v;
          },
        }),
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => true,
          releaseLock: () => {},
        }),
      },
      GmailApp: {
        getUserLabelByName: (name: string) => ({ name }),
        createLabel: (name: string) => ({ name }),
        search: (query: string) => {
          capturedQueries.push(query);
          return [
            {
              getMessages: () => mockMessages,
              addLabel: () => {},
            },
          ];
        },
      },
      UrlFetchApp: {
        fetch: (_url: string, opts: { payload: string }) => {
          postedPayloads.push(JSON.parse(opts.payload) as Record<string, unknown>);
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ ok: true, matched: true }),
          };
        },
      },
      Logger: { log: () => {} },
      ContentService: {
        MimeType: { JSON: 'application/json' },
        createTextOutput: (t: string) => ({
          setMimeType: () => t,
        }),
      },
      ScriptApp: {
        getProjectTriggers: () => [],
        deleteTrigger: () => {},
        newTrigger: () => ({
          timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }),
        }),
      },
    };

    const runner = new Function(
      ...Object.keys(sandboxGlobals),
      `${code}\nreturn { pollBankEmails: pollBankEmails, buildBridgePayload_: buildBridgePayload_ };`
    );
    const exportsObj = runner(...Object.values(sandboxGlobals)) as {
      pollBankEmails: () => { ok: boolean; scanned: number; dispatched: number; skipped: number };
      buildBridgePayload_: (msg: unknown) => { headers: Record<string, string> };
    };

    const stats = exportsObj.pollBankEmails();
    expect(capturedQueries[0]).toBe('(from:cake.vn OR from:timo.vn) newer_than:1d');
    expect(stats.ok).toBe(true);
    expect(stats.scanned).toBe(4);
    expect(stats.skipped).toBe(3);
    expect(stats.dispatched).toBe(1);
    expect(postedPayloads).toHaveLength(1);
    expect(postedPayloads[0]?.amount).toBe(50000);
    expect(postedPayloads[0]?.txId).toBe('FTGOOD01');

    const bridge = exportsObj.buildBridgePayload_(
      makeMsg({
        id: 'm_bridge',
        from: 'no-reply@cake.vn',
        auth: 'mx.google.com; dkim=pass header.d=cake.vn',
        arcSeal: 'i=1; d=google.com; cv=none; b=sig',
        body: '<p>ok</p>',
      })
    );
    expect(bridge.headers['arc-seal']).toBe('i=1; d=google.com; cv=none; b=sig');
  });

  it('throws on invalid configuration', () => {
    expect(() =>
      generateAppsScriptCode({
        mode: 'cloud_bridge',
        ingestUrl: '',
        expectedAccountNo: '0835117727',
      })
    ).toThrow();
    expect(() =>
      generateAppsScriptCode({
        mode: 'cloud_bridge',
        ingestUrl: 'https://example.com',
        expectedAccountNo: 'abc',
      })
    ).toThrow();
  });
});
