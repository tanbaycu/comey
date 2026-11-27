import { listSupportedBanks } from '@comey/core';
import { Hono } from 'hono';
import type { AppContextEnv } from './env.js';
import { csrfOriginGuardMiddleware, securityHeadersMiddleware } from './middleware/security.js';
import { createApiKeyRoutes } from './routes/apiKeys.js';
import { createAuthRoutes } from './routes/auth.js';
import { createBankAccountRoutes } from './routes/bankAccounts.js';
import { createCheckoutRoutes } from './routes/checkout.js';
import { createDynamicQrRoutes } from './routes/qr.js';
import { createDeliveryRoutes } from './routes/deliveries.js';
import { createIngestRoutes } from './routes/ingest.js';
import { createOpenApiRoutes } from './routes/openapi.js';
import { createQuarantineRoutes } from './routes/quarantine.js';
import { createRoutingRuleRoutes } from './routes/routingRules.js';
import { createSecurityRoutes } from './routes/security.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSoundboxRoutes } from './routes/soundbox.js';
import { createTransactionRoutes } from './routes/transactions.js';

export interface CreateAppOptions {
  webhookFetch?: typeof fetch;
}

export function createApp(options?: CreateAppOptions): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.use('*', securityHeadersMiddleware);
  app.use('/v1/*', csrfOriginGuardMiddleware);

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'comey-cloud',
      timestamp: new Date().toISOString(),
    })
  );

  app.get('/v1/banks', (c) =>
    c.json({
      ok: true,
      banks: listSupportedBanks(),
    })
  );

  app.route('/v1/openapi.json', createOpenApiRoutes());

  app.route('/v1/auth', createAuthRoutes());
  app.route('/v1/api-keys', createApiKeyRoutes());
  app.route('/v1/bank-accounts', createBankAccountRoutes());
  app.route('/v1/routing-rules', createRoutingRuleRoutes());
  app.route('/v1/ingest', createIngestRoutes({ webhookFetch: options?.webhookFetch }));

  const txRoutes = createTransactionRoutes({ webhookFetch: options?.webhookFetch });
  app.route('/v1/transactions', txRoutes.transactions);
  app.route('/v1/simulator', txRoutes.simulator);

  app.route('/v1/deliveries', createDeliveryRoutes({ webhookFetch: options?.webhookFetch }));
  app.route('/v1/quarantine', createQuarantineRoutes());
  app.route('/v1/sessions', createSessionRoutes());

  const securityRoutes = createSecurityRoutes();
  app.route('/v1/audit-logs', securityRoutes.auditLogs);
  app.route('/v1/security', securityRoutes.securitySummary);

  const checkout = createCheckoutRoutes({ appsScriptFetch: options?.webhookFetch });
  app.route('/p', checkout.portal);
  app.route('/api/checkout', checkout.api);

  const dynamicQr = createDynamicQrRoutes();
  app.route('/qr', dynamicQr);

  const soundbox = createSoundboxRoutes();
  app.route('/v1/soundboxes', soundbox.soundboxes);
  app.route('/soundbox', soundbox.kiosk);
  app.route('/api/soundbox', soundbox.api);

  app.notFound((c) => c.json({ ok: false, error: 'Not Found' }, 404));

  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        level: 'error',
        path: c.req.path,
        method: c.req.method,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return c.json({ ok: false, error: 'Internal Server Error' }, 500);
  });

  return app;
}
