import type {
  ApiKeyItem,
  ApiRequestLogItem,
  ApiUsageSummary,
  AuditLogItem,
  BankAccount,
  BankCatalogItem,
  PaymentSessionItem,
  QuarantineItem,
  RoutingRule,
  SecuritySummary,
  SimulationResponse,
  SoundboxItem,
  TransactionItem,
  UserInfo,
  WebhookDeliveryDetail,
  WebhookDeliveryItem,
  WebhookPayloadFormat,
  WorkspaceInfo,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });
  const data = (await resp.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string } & T)
    | null;

  if (
    resp.status === 401 &&
    path !== '/v1/auth/me' &&
    path !== '/v1/auth/login' &&
    path !== '/v1/auth/change-password'
  ) {
    unauthorizedHandler?.();
  }

  if (!resp.ok || !data || data.ok === false) {
    throw new ApiError(
      resp.status,
      data?.error || `Yêu cầu thất bại (HTTP ${resp.status})`
    );
  }
  return data;
}

export const api = {
  auth: {
    me: () => apiRequest<{ ok: true; user: UserInfo; workspace: WorkspaceInfo }>('/v1/auth/me'),
    login: (email: string, password: string) =>
      apiRequest<{ ok: true; user: UserInfo; workspace: WorkspaceInfo }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (payload: {
      email: string;
      password: string;
      name: string;
      workspaceName?: string;
      bootstrapKey?: string;
    }) =>
      apiRequest<{ ok: true; user: UserInfo; workspace: WorkspaceInfo }>(
        '/v1/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),
    logout: () =>
      apiRequest<{ ok: true }>('/v1/auth/logout', {
        method: 'POST',
      }),
    logoutAll: () =>
      apiRequest<{ ok: true }>('/v1/auth/logout-all', {
        method: 'POST',
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      apiRequest<{ ok: true }>('/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },

  banks: {
    list: () => apiRequest<{ ok: true; banks: BankCatalogItem[] }>('/v1/banks'),
  },

  bankAccounts: {
    list: () =>
      apiRequest<{ ok: true; bankAccounts: BankAccount[] }>('/v1/bank-accounts'),
    create: (payload: {
      bankCode: string;
      accountNumber: string;
      accountName: string;
      strictAuth?: boolean;
    }) =>
      apiRequest<{ ok: true; bankAccount: BankAccount; appsScriptToken: string }>(
        '/v1/bank-accounts',
        { method: 'POST', body: JSON.stringify(payload) }
      ),
    update: (
      id: string,
      payload: Partial<{
        accountName: string;
        strictAuth: boolean;
        enabled: boolean;
        appsScriptUrl: string | null;
        appsScriptSecret: string | null;
      }>
    ) =>
      apiRequest<{ ok: true; bankAccount: BankAccount }>(`/v1/bank-accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    remove: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/bank-accounts/${id}`, { method: 'DELETE' }),
    getAppsScript: (id: string, mode: 'cloud_bridge' | 'standalone', webhookUrl?: string) => {
      const qs = new URLSearchParams({ mode });
      if (webhookUrl) qs.set('webhookUrl', webhookUrl);
      return apiRequest<{ ok: true; mode: string; ingestUrl: string; code: string }>(
        `/v1/bank-accounts/${id}/apps-script?${qs.toString()}`
      );
    },
    rotateAppsScriptToken: (id: string) =>
      apiRequest<{ ok: true; appsScriptToken: string }>(
        `/v1/bank-accounts/${id}/rotate-apps-script-token`,
        { method: 'POST' }
      ),
    confirmForwarding: (id: string) =>
      apiRequest<{ ok: true; forwardingStatus: string }>(
        `/v1/bank-accounts/${id}/confirm-forwarding`,
        { method: 'POST' }
      ),
  },

  routingRules: {
    list: () => apiRequest<{ ok: true; routingRules: RoutingRule[] }>('/v1/routing-rules'),
    create: (payload: {
      bankAccountId: string;
      name: string;
      matchType: 'prefix' | 'regex' | 'all';
      pattern?: string;
      priority?: number;
      webhookUrl?: string;
      telegramBotToken?: string;
      telegramChatId?: string;
      payloadFormat?: WebhookPayloadFormat;
      stopOnMatch?: boolean;
    }) =>
      apiRequest<{ ok: true; routingRule: RoutingRule; webhookSecret: string }>(
        '/v1/routing-rules',
        { method: 'POST', body: JSON.stringify(payload) }
      ),
    update: (
      id: string,
      payload: Partial<{
        name: string;
        enabled: boolean;
        priority: number;
        pattern: string;
        webhookUrl: string;
        telegramBotToken: string;
        telegramChatId: string;
        payloadFormat: WebhookPayloadFormat;
        stopOnMatch: boolean;
      }>
    ) =>
      apiRequest<{ ok: true; routingRule: RoutingRule }>(`/v1/routing-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    rotateSecret: (id: string) =>
      apiRequest<{ ok: true; webhookSecret: string }>(
        `/v1/routing-rules/${id}/rotate-secret`,
        { method: 'POST' }
      ),
    remove: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/routing-rules/${id}`, { method: 'DELETE' }),
  },

  transactions: {
    list: (params?: { orderCode?: string; bankAccountId?: string; includeTest?: boolean }) => {
      const qs = new URLSearchParams({ limit: '100' });
      if (params?.orderCode) qs.set('orderCode', params.orderCode);
      if (params?.bankAccountId) qs.set('bankAccountId', params.bankAccountId);
      if (params?.includeTest === false) qs.set('includeTest', 'false');
      return apiRequest<{ ok: true; transactions: TransactionItem[] }>(
        `/v1/transactions?${qs.toString()}`
      );
    },
  },

  simulator: {
    transfer: (payload: {
      bankAccountId: string;
      amount: number;
      content: string;
      senderName?: string;
      senderBank?: string;
    }) =>
      apiRequest<SimulationResponse>('/v1/simulator/transfer', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  deliveries: {
    list: (status?: string) => {
      const qs = new URLSearchParams({ limit: '100' });
      if (status && status !== 'all') qs.set('status', status);
      return apiRequest<{ ok: true; deliveries: WebhookDeliveryItem[] }>(
        `/v1/deliveries?${qs.toString()}`
      );
    },
    get: (id: string) =>
      apiRequest<{ ok: true; delivery: WebhookDeliveryDetail }>(`/v1/deliveries/${id}`),
    replay: (id: string) =>
      apiRequest<{ ok: true; delivery: unknown }>(`/v1/deliveries/${id}/replay`, {
        method: 'POST',
      }),
  },

  soundboxes: {
    list: () => apiRequest<{ ok: true; soundboxes: SoundboxItem[] }>('/v1/soundboxes'),
    create: (payload: {
      name: string;
      bankAccountId?: string | null;
      voiceLang?: string;
      voiceTemplate?: string;
      minAmount?: number;
      enabled?: boolean;
    }) =>
      apiRequest<{
        ok: true;
        soundbox: SoundboxItem;
        kioskToken: string;
        kioskUrl: string;
        eventsUrl: string;
      }>('/v1/soundboxes', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      id: string,
      payload: Partial<{
        name: string;
        bankAccountId: string | null;
        voiceLang: string;
        voiceTemplate: string;
        minAmount: number;
        enabled: boolean;
      }>
    ) =>
      apiRequest<{ ok: true; soundbox: SoundboxItem }>(`/v1/soundboxes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    rotateToken: (id: string) =>
      apiRequest<{
        ok: true;
        kioskToken: string;
        kioskUrl: string;
        eventsUrl: string;
      }>(`/v1/soundboxes/${id}/rotate-token`, { method: 'POST' }),
    remove: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/soundboxes/${id}`, { method: 'DELETE' }),
  },

  quarantine: {
    list: (status: 'quarantined' | 'dismissed' = 'quarantined') =>
      apiRequest<{ ok: true; quarantine: QuarantineItem[] }>(
        `/v1/quarantine?status=${status}`
      ),
    dismiss: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/quarantine/${id}/dismiss`, { method: 'POST' }),
    remove: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/quarantine/${id}`, { method: 'DELETE' }),
  },

  sessions: {
    list: (status?: string) => {
      const qs = new URLSearchParams({ limit: '100' });
      if (status && status !== 'all') qs.set('status', status);
      return apiRequest<{ ok: true; sessions: PaymentSessionItem[] }>(
        `/v1/sessions?${qs.toString()}`
      );
    },
    create: (payload: {
      bankAccountId: string;
      orderCode: string;
      amount: number;
      ttlSeconds?: number;
      exactMatchOnly?: boolean;
      returnUrl?: string;
    }) =>
      apiRequest<{
        ok: true;
        session: PaymentSessionItem;
        checkoutUrl: string;
        qrPngUrl: string;
        vietqr: { emvco: string; svg: string };
      }>('/v1/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    cancel: (id: string) =>
      apiRequest<{ ok: true; session: PaymentSessionItem }>(
        `/v1/sessions/${id}/cancel`,
        { method: 'POST' }
      ),
  },

  apiKeys: {
    list: () =>
      apiRequest<{
        ok: true;
        apiKeys: ApiKeyItem[];
        availableScopes?: string[];
        presets?: Record<string, string[]>;
      }>('/v1/api-keys'),
    create: (payload: {
      name: string;
      description?: string;
      isTest: boolean;
      scopes?: string[];
      rateLimitRpm?: number;
      allowedIps?: string | string[] | null;
      expiresInDays?: number | null;
    }) =>
      apiRequest<{
        ok: true;
        apiKey: ApiKeyItem & { keyPrefix: string; plaintextKey: string };
      }>('/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      id: string,
      payload: Partial<{
        name: string;
        description: string | null;
        scopes: string[];
        rateLimitRpm: number;
        allowedIps: string | string[] | null;
        enabled: boolean;
        expiresInDays: number | null;
        expiresAt: null;
      }>
    ) =>
      apiRequest<{ ok: true; apiKey: ApiKeyItem }>(`/v1/api-keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    rotate: (id: string) =>
      apiRequest<{
        ok: true;
        apiKey: ApiKeyItem & { keyPrefix: string; plaintextKey: string };
      }>(`/v1/api-keys/${id}/rotate`, { method: 'POST' }),
    logs: (params?: { apiKeyId?: string; status?: 'all' | 'error' | 'ok'; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.apiKeyId) qs.set('apiKeyId', params.apiKeyId);
      if (params?.status && params.status !== 'all') qs.set('status', params.status);
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return apiRequest<{
        ok: true;
        logs: ApiRequestLogItem[];
        summary: ApiUsageSummary;
      }>(`/v1/api-keys/logs${query ? `?${query}` : ''}`);
    },
    revoke: (id: string) =>
      apiRequest<{ ok: true }>(`/v1/api-keys/${id}`, { method: 'DELETE' }),
  },

  openApi: {
    getSpec: async (): Promise<Record<string, unknown>> => {
      const resp = await fetch('/v1/openapi.json', { credentials: 'include' });
      if (!resp.ok) {
        throw new ApiError(resp.status, 'Không thể tải đặc tả OpenAPI');
      }
      return (await resp.json()) as Record<string, unknown>;
    },
  },

  security: {
    summary: () =>
      apiRequest<{ ok: true; summary: SecuritySummary }>('/v1/security/summary'),
    auditLogs: () =>
      apiRequest<{ ok: true; auditLogs: AuditLogItem[] }>('/v1/audit-logs?limit=100'),
  },
};
