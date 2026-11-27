import { API_KEY_PRESETS, API_KEY_SCOPES } from '@comey/core';
import { Hono } from 'hono';
import type { AppContextEnv } from '../env.js';

export function createOpenApiRoutes(): Hono<AppContextEnv> {
  const app = new Hono<AppContextEnv>();

  app.get('/', (c) => {
    const origin = String(c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(
      /\/$/,
      ''
    );
    c.header('Cache-Control', 'public, max-age=300');

    return c.json({
      openapi: '3.1.0',
      info: {
        title: 'Comey Pay Cloud API',
        version: '1.1.0',
        description:
          'Zero-fee bank transfer verification, SePay/PayOS drop-in webhooks, VietQR Checkout, and Soundbox IoT API.',
      },
      servers: [{ url: origin, description: 'Active Comey Worker Endpoint' }],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Workspace API Key (`cm_live_...` or `cm_test_...`)',
          },
          ApiKeyHeader: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'Alternative header for Workspace API Key',
          },
        },
        schemas: {
          SePayWebhookPayload: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              gateway: { type: 'string', example: 'CAKE' },
              transactionDate: { type: 'string', example: '2026-11-26 12:30:15' },
              accountNumber: { type: 'string' },
              code: { type: ['string', 'null'] },
              content: { type: 'string' },
              transferType: { type: 'string', enum: ['in', 'out'] },
              transferAmount: { type: 'integer' },
              accumulated: { type: 'integer' },
              subAccount: { type: ['string', 'null'] },
              referenceCode: { type: 'string' },
              description: { type: 'string' },
            },
          },
          PayOSWebhookPayload: {
            type: 'object',
            properties: {
              code: { type: 'string', example: '00' },
              desc: { type: 'string', example: 'success' },
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  orderCode: { type: 'integer' },
                  amount: { type: 'integer' },
                  description: { type: 'string' },
                  accountNumber: { type: 'string' },
                  reference: { type: 'string' },
                  transactionDateTime: { type: 'string' },
                  currency: { type: 'string', example: 'VND' },
                },
              },
              signature: {
                type: 'string',
                description: 'HMAC-SHA256 hex digest over sorted data keys',
              },
            },
          },
        },
      },
      'x-api-scopes': API_KEY_SCOPES,
      'x-api-presets': API_KEY_PRESETS,
      paths: {
        '/v1/banks': {
          get: {
            summary: 'List supported Vietnamese banks',
            responses: { '200': { description: 'Bank catalog list' } },
          },
        },
        '/v1/transactions': {
          get: {
            summary: 'List normalized bank transactions',
            'x-required-scope': 'transactions:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            parameters: [
              { name: 'orderCode', in: 'query', schema: { type: 'string' } },
              { name: 'bankAccountId', in: 'query', schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            ],
            responses: { '200': { description: 'Transactions list' } },
          },
        },
        '/v1/sessions': {
          get: {
            summary: 'List VietQR checkout payment sessions',
            'x-required-scope': 'sessions:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Payment sessions' } },
          },
          post: {
            summary: 'Create a VietQR checkout payment session',
            'x-required-scope': 'sessions:write',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '201': { description: 'Created payment session with QR' } },
          },
        },
        '/v1/bank-accounts': {
          get: {
            summary: 'List linked bank accounts',
            'x-required-scope': 'accounts:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Bank accounts' } },
          },
          post: {
            summary: 'Register a bank account (requires live key)',
            'x-required-scope': 'accounts:write',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '201': { description: 'Created bank account' } },
          },
        },
        '/v1/routing-rules': {
          get: {
            summary: 'List webhook & no-server notification routing rules',
            'x-required-scope': 'webhooks:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Routing rules' } },
          },
          post: {
            summary:
              'Create Comey / SePay / PayOS / Telegram / Discord / Google Sheets routing rule (requires live key)',
            'x-required-scope': 'webhooks:write',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '201': { description: 'Created routing rule + one-time secret' } },
          },
        },
        '/v1/deliveries': {
          get: {
            summary: 'List webhook deliveries',
            'x-required-scope': 'webhooks:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Webhook delivery summaries' } },
          },
        },
        '/v1/soundboxes': {
          get: {
            summary: 'List configured Soundbox devices',
            'x-required-scope': 'soundboxes:read',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Soundbox list' } },
          },
          post: {
            summary: 'Create Soundbox Kiosk / IoT token (requires live key)',
            'x-required-scope': 'soundboxes:write',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '201': { description: 'Created Soundbox + one-time URLs' } },
          },
        },
        '/v1/simulator/transfer': {
          post: {
            summary: 'Simulate incoming transfer for testing',
            'x-required-scope': 'simulator:write',
            security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
            responses: { '200': { description: 'Simulation execution report' } },
          },
        },
        '/api/soundbox/{token}/events': {
          get: {
            summary: 'Public IoT/Kiosk polling feed for incoming VND speech announcements',
            parameters: [
              { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            ],
            responses: { '200': { description: 'Chronological payment speech events' } },
          },
        },
        '/api/soundbox/{token}/pos-qr': {
          get: {
            summary: 'Generate instant POS VietQR SVG for the paired Soundbox bank account',
            parameters: [
              { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'amount', in: 'query', schema: { type: 'integer' } },
              { name: 'note', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'Instant VietQR SVG & account display info' } },
          },
        },
        '/qr': {
          get: {
            summary: 'Public cached dynamic VietQR image generator (PNG / SVG)',
            parameters: [
              { name: 'bank', in: 'query', required: true, schema: { type: 'string' } },
              { name: 'acc', in: 'query', required: true, schema: { type: 'string' } },
              { name: 'amount', in: 'query', schema: { type: 'integer' } },
              { name: 'des', in: 'query', schema: { type: 'string' } },
              {
                name: 'format',
                in: 'query',
                schema: { type: 'string', enum: ['png', 'svg'], default: 'png' },
              },
            ],
            responses: { '200': { description: 'Cached image/png or image/svg+xml QR code' } },
          },
        },
      },
    });
  });

  return app;
}
