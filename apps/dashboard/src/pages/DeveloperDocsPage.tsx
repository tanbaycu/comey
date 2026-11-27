import { Key as PhKey } from '@phosphor-icons/react';
import {
  AlertTriangle,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Shield,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../components/Badge';
import { BrandIcon } from '../components/BrandIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { DeployControlDeck } from '../components/DeployControlDeck';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { SheetDrawer } from '../components/SheetDrawer';
import { TerminalCodeKit } from '../components/TerminalCodeKit';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { buildIntegrationSnippet, type SnippetLanguage } from '../lib/snippets';
import type {
  ApiKeyItem,
  ApiRequestLogItem,
  ApiUsageSummary,
  BankAccount,
  RoutingRule,
} from '../lib/types';

type ManagerTab = 'deploy' | 'keys' | 'logs' | 'playground' | 'openapi';
type PresetKey = 'merchant_bot' | 'readonly' | 'sandbox' | 'full_admin' | 'custom';

const ALL_SCOPES: Array<{ id: string; label: string }> = [
  { id: 'transactions:read', label: 'Đọc giao dịch' },
  { id: 'sessions:read', label: 'Xem phiên QR' },
  { id: 'sessions:write', label: 'Tạo/Hủy phiên QR' },
  { id: 'accounts:read', label: 'Xem tài khoản NH' },
  { id: 'accounts:write', label: 'Sửa tài khoản NH' },
  { id: 'webhooks:read', label: 'Xem định tuyến' },
  { id: 'webhooks:write', label: 'Sửa định tuyến & gửi lại' },
  { id: 'soundboxes:read', label: 'Xem loa thu ngân' },
  { id: 'soundboxes:write', label: 'Tạo/Sửa loa thu ngân' },
  { id: 'simulator:write', label: 'Chạy giả lập giao dịch' },
  { id: 'quarantine:read', label: 'Xem hộp cách ly' },
  { id: 'quarantine:write', label: 'Xử lý hộp cách ly' },
  { id: 'security:read', label: 'Xem nhật ký bảo mật' },
  { id: '*', label: 'Toàn quyền (*)' },
];

const PRESET_DEFS: Record<
  Exclude<PresetKey, 'custom'>,
  { label: string; scopes: string[]; defaultIsTest: boolean; hint: string }
> = {
  merchant_bot: {
    label: 'Bot & Website bán hàng',
    scopes: ['sessions:read', 'sessions:write', 'transactions:read'],
    defaultIsTest: false,
    hint: 'Chỉ cấp quyền tạo mã VietQR thanh toán và đọc giao dịch tiền vào.',
  },
  readonly: {
    label: 'Chỉ đọc báo cáo đối soát',
    scopes: ['transactions:read', 'sessions:read', 'accounts:read'],
    defaultIsTest: false,
    hint: 'Chỉ xem dữ liệu giao dịch và phiên thanh toán, không thể ghi dữ liệu.',
  },
  sandbox: {
    label: 'Môi trường Sandbox (cm_test_)',
    scopes: ['sessions:read', 'sessions:write', 'transactions:read', 'simulator:write'],
    defaultIsTest: true,
    hint: 'Cô lập hoàn toàn vào dữ liệu thử nghiệm, không ảnh hưởng dữ liệu live.',
  },
  full_admin: {
    label: 'Toàn quyền (*)',
    scopes: ['*'],
    defaultIsTest: false,
    hint: 'Toàn quyền trên tài nguyên workspace (ngoại trừ quản lý API Key).',
  },
};

function keyStatusTone(status: ApiKeyItem['status']): 'green' | 'amber' | 'rose' | 'slate' {
  if (status === 'active') return 'green';
  if (status === 'paused') return 'amber';
  if (status === 'revoked' || status === 'expired') return 'rose';
  return 'slate';
}

export function DeveloperDocsPage({
  apiKeys,
  accounts = [],
  rules = [],
  onReload,
  onNavigate,
  onNotify,
  openCreateSignal = 0,
  openDeploySignal = 0,
}: {
  apiKeys: ApiKeyItem[];
  accounts?: BankAccount[];
  rules?: RoutingRule[];
  onReload: () => Promise<void>;
  onNavigate?: (tab: string) => void;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  openCreateSignal?: number;
  openDeploySignal?: number;
}) {
  const [subTab, setSubTab] = useState<ManagerTab>('deploy');
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const [keyName, setKeyName] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<PresetKey>('merchant_bot');
  const [scopes, setScopes] = useState<string[]>(PRESET_DEFS.merchant_bot.scopes);
  const [isTest, setIsTest] = useState(false);
  const [rateLimitRpm, setRateLimitRpm] = useState(120);
  const [allowedIpsText, setAllowedIpsText] = useState('');
  const [expiryDays, setExpiryDays] = useState<'none' | '30' | '90' | '365'>('90');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{
    name: string;
    plaintextKey: string;
  } | null>(null);

  const [editTarget, setEditTarget] = useState<ApiKeyItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editRpm, setEditRpm] = useState(120);
  const [editIps, setEditIps] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<ApiKeyItem | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);

  const [logs, setLogs] = useState<ApiRequestLogItem[]>([]);
  const [summary, setSummary] = useState<ApiUsageSummary | null>(null);
  const [logKeyFilter, setLogKeyFilter] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'error' | 'ok'>('all');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [pgEndpoint, setPgEndpoint] = useState('GET /v1/transactions');
  const [pgApiKey, setPgApiKey] = useState('');
  const [pgBody, setPgBody] = useState('');
  const [pgRunning, setPgRunning] = useState(false);
  const [pgResult, setPgResult] = useState<{
    status: number;
    latencyMs: number;
    rateLimitHeader: string | null;
    body: string;
  } | null>(null);

  const [lang, setLang] = useState<SnippetLanguage>('node');
  const [openApiPaths, setOpenApiPaths] = useState<
    Array<{ path: string; methods: string[]; summary: string; scope?: string }>
  >([]);
  const [loadingSpec, setLoadingSpec] = useState(false);

  useEffect(() => {
    if (openCreateSignal > 0) {
      setSubTab('keys');
      setCreateDrawerOpen(true);
    }
  }, [openCreateSignal]);

  useEffect(() => {
    if (openDeploySignal > 0) {
      setSubTab('deploy');
    }
  }, [openDeploySignal]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pay.comey.dev';
  const snippet = buildIntegrationSnippet(lang, origin);
  const openApiUrl = `${origin}/v1/openapi.json`;

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await api.apiKeys.logs({
        apiKeyId: logKeyFilter || undefined,
        status: logStatusFilter,
        limit: 100,
      });
      setLogs(res.logs);
      setSummary(res.summary);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể tải nhật ký API');
    } finally {
      setLoadingLogs(false);
    }
  }, [logKeyFilter, logStatusFilter, onNotify]);

  const loadOpenApi = useCallback(async () => {
    setLoadingSpec(true);
    try {
      const spec = await api.openApi.getSpec();
      const pathsObj = (spec.paths ?? {}) as Record<
        string,
        Record<string, { summary?: string; 'x-required-scope'?: string }>
      >;
      const entries: Array<{ path: string; methods: string[]; summary: string; scope?: string }> =
        [];
      for (const [pathStr, methodsMap] of Object.entries(pathsObj)) {
        const methods = Object.keys(methodsMap).map((m) => m.toUpperCase());
        const firstOp = Object.values(methodsMap)[0];
        entries.push({
          path: pathStr,
          methods,
          summary: firstOp?.summary ?? '',
          scope: firstOp?.['x-required-scope'],
        });
      }
      setOpenApiPaths(entries);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể tải OpenAPI JSON');
    } finally {
      setLoadingSpec(false);
    }
  }, [onNotify]);

  useEffect(() => {
    if (subTab === 'logs') {
      void loadLogs();
    } else if (subTab === 'openapi' && openApiPaths.length === 0) {
      void loadOpenApi();
    }
  }, [subTab, loadLogs, loadOpenApi, openApiPaths.length]);

  function handleSelectPreset(nextPreset: PresetKey) {
    setPreset(nextPreset);
    if (nextPreset === 'custom') return;
    const def = PRESET_DEFS[nextPreset];
    setScopes([...def.scopes]);
    setIsTest(def.defaultIsTest);
  }

  function toggleScope(targetList: string[], setList: (next: string[]) => void, scopeId: string) {
    if (scopeId === '*') {
      setList(targetList.includes('*') ? ['transactions:read'] : ['*']);
      return;
    }
    const withoutWildcard = targetList.filter((s) => s !== '*');
    if (withoutWildcard.includes(scopeId)) {
      const next = withoutWildcard.filter((s) => s !== scopeId);
      setList(next.length > 0 ? next : [scopeId]);
    } else {
      setList([...withoutWildcard, scopeId]);
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.apiKeys.create({
        name: keyName.trim() || 'API Client',
        description: description.trim() || undefined,
        isTest,
        scopes,
        rateLimitRpm,
        allowedIps: allowedIpsText.trim() || null,
        expiresInDays: expiryDays === 'none' ? null : Number(expiryDays),
      });
      setRevealedKey({
        name: res.apiKey.name,
        plaintextKey: res.apiKey.plaintextKey,
      });
      setKeyName('');
      setDescription('');
      setCreateDrawerOpen(false);
      await onReload();
      onNotify('success', 'Đã tạo API Key phân quyền thành công');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi tạo API Key');
    } finally {
      setCreating(false);
    }
  }

  function openEditModal(k: ApiKeyItem) {
    setEditTarget(k);
    setEditName(k.name);
    setEditDesc(k.description || '');
    setEditScopes(k.scopes?.length ? k.scopes : ['*']);
    setEditRpm(k.rateLimitRpm || 120);
    setEditIps((k.allowedIps ?? []).join(', '));
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await api.apiKeys.update(editTarget.id, {
        name: editName.trim() || editTarget.name,
        description: editDesc.trim() || null,
        scopes: editScopes,
        rateLimitRpm: editRpm,
        allowedIps: editIps.trim() || null,
      });
      setEditTarget(null);
      await onReload();
      onNotify('success', 'Đã cập nhật cấu hình API Key');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể cập nhật API Key');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleTogglePause(k: ApiKeyItem) {
    try {
      await api.apiKeys.update(k.id, { enabled: !k.enabled });
      await onReload();
      onNotify('success', k.enabled ? 'Đã tạm khóa API Key' : 'Đã kích hoạt lại API Key');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi cập nhật trạng thái');
    }
  }

  async function handleRotateConfirmed() {
    if (!rotateTarget) return;
    try {
      const res = await api.apiKeys.rotate(rotateTarget.id);
      setRevealedKey({
        name: res.apiKey.name,
        plaintextKey: res.apiKey.plaintextKey,
      });
      await onReload();
      onNotify('success', `Đã cấp key mới cho "${rotateTarget.name}"`);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể xoay API Key');
    }
  }

  async function handleRevokeConfirmed() {
    if (!revokeTarget) return;
    try {
      await api.apiKeys.revoke(revokeTarget.id);
      await onReload();
      onNotify('success', 'Đã thu hồi API Key vĩnh viễn');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể thu hồi key');
    }
  }

  function handleSelectPlaygroundEndpoint(nextEp: string) {
    setPgEndpoint(nextEp);
    if (nextEp === 'POST /v1/sessions') {
      setPgBody(
        JSON.stringify(
          {
            bankAccountId: accounts[0]?.id || 'ba_your_account_id',
            orderCode: `DEMO${Date.now().toString().slice(-4)}`,
            amount: 50000,
            ttlSeconds: 900,
          },
          null,
          2
        )
      );
    } else if (nextEp === 'POST /v1/simulator/transfer') {
      setPgBody(
        JSON.stringify(
          {
            bankAccountId: accounts[0]?.id || 'ba_your_account_id',
            amount: 50000,
            content: 'DEMO TEST',
          },
          null,
          2
        )
      );
    } else {
      setPgBody('');
    }
  }

  async function handleRunPlayground(e: React.FormEvent) {
    e.preventDefault();
    const [method = 'GET', path = '/v1/banks'] = pgEndpoint.split(' ');
    setPgRunning(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (pgApiKey.trim()) {
        headers.Authorization = `Bearer ${pgApiKey.trim()}`;
      }
      if (method !== 'GET' && pgBody.trim()) {
        headers['Content-Type'] = 'application/json';
      }
      const resp = await fetch(path, {
        method,
        headers,
        credentials: pgApiKey.trim() ? 'omit' : 'include',
        body: method !== 'GET' && pgBody.trim() ? pgBody : undefined,
      });
      const latencyMs = Math.round(performance.now() - t0);
      const rawText = await resp.text();
      let formatted = rawText;
      try {
        formatted = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        formatted = rawText;
      }
      const limit = resp.headers.get('x-ratelimit-limit');
      const rem = resp.headers.get('x-ratelimit-remaining');
      setPgResult({
        status: resp.status,
        latencyMs,
        rateLimitHeader: limit ? `${rem ?? '?'}/${limit} req/min` : null,
        body: formatted,
      });
    } catch (err) {
      setPgResult({
        status: 0,
        latencyMs: Math.round(performance.now() - t0),
        rateLimitHeader: null,
        body: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setPgRunning(false);
    }
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Triển khai &amp; API
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5">
            Kiểm tra Cloudflare Workers / D1, sinh cấu hình Production, quản lý API Key phân
            quyền RBAC và OpenAPI 3.1.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSubTab('keys');
            setCreateDrawerOpen(true);
          }}
          className="cm-btn cm-btn-primary"
        >
          <Plus className="w-4 h-4" /> Tạo API Key
        </button>
      </div>

      <SegmentedControl
        value={subTab}
        onChange={setSubTab}
        ariaLabel="Khu vực triển khai và API"
        options={[
          { value: 'deploy', label: 'Triển khai Edge' },
          { value: 'keys', label: 'API Keys', count: apiKeys.length },
          { value: 'logs', label: 'Nhật ký API' },
          { value: 'playground', label: 'Playground' },
          { value: 'openapi', label: 'OpenAPI & SDK' },
        ]}
      />

      {subTab === 'deploy' && (
        <div className="space-y-6 min-w-0">
          <DeployControlDeck
            accounts={accounts}
            rules={rules}
            apiKeys={apiKeys}
            onNavigate={onNavigate}
            onOpenCreateKey={() => {
              setSubTab('keys');
              setCreateDrawerOpen(true);
            }}
            onNotify={onNotify}
          />
          <TerminalCodeKit onNotify={onNotify} />
        </div>
      )}

      {subTab === 'keys' && (
        <div className="space-y-5 min-w-0">
          {revealedKey && (
            <div className="cm-panel border-[#A7F3D0] bg-[#ECFDF5]/60 p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
              <div className="text-[12.5px] text-[#047857] min-w-0 flex-1 space-y-0.5">
                <div className="font-semibold">
                  API Key &ldquo;{revealedKey.name}&rdquo; (chỉ hiển thị một lần sau khi cấp)
                </div>
                <code className="block font-mono-num text-[13px] font-semibold text-[#09090B] break-all">
                  {revealedKey.plaintextKey}
                </code>
              </div>
              <CopyButton
                value={revealedKey.plaintextKey}
                label="Sao chép Key"
                variant="dark"
                onCopied={(ok) =>
                  onNotify(
                    ok ? 'success' : 'error',
                    ok ? 'Đã sao chép API Key' : 'Không thể sao chép'
                  )
                }
              />
            </div>
          )}

          <div className="cm-panel overflow-hidden min-w-0">
            {apiKeys.length === 0 ? (
              <EmptyState
                icon={PhKey}
                title="Chưa có API Key nào"
                description="Khởi tạo API Key phân quyền để tích hợp website, Telegram Bot hoặc hệ thống nội bộ."
                action={
                  <button
                    type="button"
                    onClick={() => setCreateDrawerOpen(true)}
                    className="cm-btn cm-btn-primary"
                  >
                    <Plus className="w-4 h-4" /> Tạo API Key đầu tiên
                  </button>
                }
              />
            ) : (
              <div className="divide-y divide-black/[0.06]">
                {apiKeys.map((k) => {
                  const isRevoked = k.status === 'revoked';
                  return (
                    <div
                      key={k.id}
                      className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 min-w-0 hover:bg-[#FAFAFA] transition-colors duration-100"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[14px] text-[#09090B]">{k.name}</span>
                          <code className="font-mono-num text-[12px] bg-[#F4F4F5] px-2 py-0.5 rounded-[5px] text-[#52525B]">
                            {k.key_prefix}...
                          </code>
                          <Badge tone={keyStatusTone(k.status)}>{k.status.toUpperCase()}</Badge>
                          <Badge tone={k.is_test === 1 ? 'blue' : 'slate'}>
                            {k.is_test === 1 ? 'SANDBOX' : 'LIVE'}
                          </Badge>
                          <Badge tone="slate">{k.rateLimitRpm || 120} rpm</Badge>
                          {k.allowedIps && k.allowedIps.length > 0 && (
                            <Badge tone="amber">{k.allowedIps.length} IP Allowlist</Badge>
                          )}
                        </div>

                        {k.description && (
                          <div className="text-[12.5px] text-[#52525B]">{k.description}</div>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          {(k.scopes ?? ['*']).map((sc) => (
                            <code
                              key={sc}
                              className="text-[11px] font-mono-num bg-[#FAFAFA] border border-black/[0.08] rounded-[5px] px-1.5 py-0.5 text-[#52525B]"
                            >
                              {sc}
                            </code>
                          ))}
                        </div>

                        <div className="text-[12px] text-[#71717A] font-mono-num flex flex-wrap gap-x-5 gap-y-1">
                          <span>Requests: {k.requestCount ?? 0}</span>
                          <span>Lỗi: {k.errorCount ?? 0}</span>
                          <span>
                            Hạn dùng: {k.expiresAt ? formatDateTime(k.expiresAt) : 'Không giới hạn'}
                          </span>
                          <span>Dùng gần nhất: {formatDateTime(k.last_used_at)}</span>
                        </div>
                      </div>

                      {!isRevoked && (
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleTogglePause(k)}
                            className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                          >
                            {k.enabled ? (
                              <>
                                <Pause className="w-3.5 h-3.5" /> Tạm khóa
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" /> Mở lại
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(k)}
                            className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Quyền
                          </button>
                          <button
                            type="button"
                            onClick={() => setRotateTarget(k)}
                            className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                          >
                            <RotateCw className="w-3.5 h-3.5" /> Xoay Key
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(k)}
                            className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-[6px] text-[#71717A] hover:text-[#DC2626] hover:bg-rose-50 cursor-pointer"
                            aria-label={`Thu hồi key ${k.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'logs' && (
        <div className="space-y-5 min-w-0">
          <div className="cm-panel grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06]">
            <div className="p-4 min-w-0">
              <div className="text-[12px] font-medium text-[#71717A]">Request API (24h)</div>
              <div className="font-mono-num text-[22px] font-semibold text-[#09090B] mt-1">
                {summary?.totalRequests24h ?? 0}
              </div>
            </div>
            <div className="p-4 min-w-0">
              <div className="text-[12px] font-medium text-[#71717A]">Lỗi 4xx / 5xx</div>
              <div className="font-mono-num text-[22px] font-semibold text-[#DC2626] mt-1">
                {summary?.errorRequests24h ?? 0}
              </div>
            </div>
            <div className="p-4 min-w-0">
              <div className="text-[12px] font-medium text-[#71717A]">Giới hạn Rate Limit</div>
              <div className="font-mono-num text-[22px] font-semibold text-amber-700 mt-1">
                {summary?.rateLimited24h ?? 0}
              </div>
            </div>
            <div className="p-4 min-w-0">
              <div className="text-[12px] font-medium text-[#71717A]">Độ trễ trung bình</div>
              <div className="font-mono-num text-[22px] font-semibold text-[#047857] mt-1">
                {summary?.avgLatencyMs ?? 0} ms
              </div>
            </div>
          </div>

          <div className="cm-panel overflow-hidden min-w-0">
            <div className="px-5 py-3.5 border-b border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[13.5px] font-semibold text-[#09090B]">
                Nhật ký gọi API ({logs.length})
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Lọc theo API Key"
                  value={logKeyFilter}
                  onChange={(e) => setLogKeyFilter(e.target.value)}
                  className="cm-input w-auto h-8 text-[12px]"
                >
                  <option value="">Tất cả API Key</option>
                  {apiKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.key_prefix}...)
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Lọc theo trạng thái HTTP"
                  value={logStatusFilter}
                  onChange={(e) => setLogStatusFilter(e.target.value as 'all' | 'error' | 'ok')}
                  className="cm-input w-auto h-8 text-[12px]"
                >
                  <option value="all">Mọi trạng thái</option>
                  <option value="ok">Thành công (2xx)</option>
                  <option value="error">Lỗi (4xx/5xx)</option>
                </select>
                <button
                  type="button"
                  disabled={loadingLogs}
                  onClick={() => void loadLogs()}
                  className="cm-btn cm-btn-secondary h-8 px-3 text-[12px]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                  Tải lại
                </button>
              </div>
            </div>
            {logs.length === 0 ? (
              <div className="p-8 text-[13px] text-[#71717A] text-center">
                Chưa ghi nhận request nào sử dụng API Key.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                    <tr>
                      <th className="px-4 py-2.5">Thời gian</th>
                      <th className="px-4 py-2.5">API Key</th>
                      <th className="px-4 py-2.5">Endpoint</th>
                      <th className="px-4 py-2.5">Trạng thái</th>
                      <th className="px-4 py-2.5 text-right">Độ trễ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {logs.map((l) => (
                      <tr key={l.id} className="hover:bg-[#FAFAFA] transition-colors duration-100">
                        <td className="px-4 py-2.5 text-[#71717A] whitespace-nowrap">
                          {formatDateTime(l.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-[#09090B]">
                          {l.apiKeyName}{' '}
                          <code className="font-mono-num text-[11px] text-[#71717A]">
                            ({l.keyPrefix}...)
                          </code>
                        </td>
                        <td className="px-4 py-2.5 font-mono-num">
                          <span className="font-semibold text-[#09090B]">{l.method}</span> {l.path}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            tone={l.statusCode < 400 ? 'green' : l.statusCode === 429 ? 'amber' : 'rose'}
                          >
                            {l.statusCode}
                            {l.errorCode ? ` (${l.errorCode})` : ''}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-num text-[#52525B]">
                          {l.latencyMs} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'playground' && (
        <form onSubmit={handleRunPlayground} className="cm-panel p-5 space-y-4 min-w-0">
          <div>
            <h3 className="text-[14px] font-semibold text-[#09090B]">
              API Playground
            </h3>
            <p className="text-[12.5px] text-[#71717A] mt-0.5">
              Kiểm tra phân quyền RBAC Scope, IP Allowlist và Rate Limit ngay trên trình duyệt.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pg-endpoint" className="block text-[12.5px] font-medium mb-1">
                Endpoint
              </label>
              <select
                id="pg-endpoint"
                value={pgEndpoint}
                onChange={(e) => handleSelectPlaygroundEndpoint(e.target.value)}
                className="cm-input font-mono-num"
              >
                <option value="GET /v1/transactions">GET /v1/transactions</option>
                <option value="GET /v1/sessions">GET /v1/sessions</option>
                <option value="POST /v1/sessions">POST /v1/sessions</option>
                <option value="GET /v1/bank-accounts">GET /v1/bank-accounts</option>
                <option value="GET /v1/routing-rules">GET /v1/routing-rules</option>
                <option value="GET /v1/soundboxes">GET /v1/soundboxes</option>
                <option value="POST /v1/simulator/transfer">POST /v1/simulator/transfer</option>
                <option value="GET /v1/security/summary">GET /v1/security/summary</option>
                <option value="GET /v1/banks">GET /v1/banks</option>
              </select>
            </div>
            <div>
              <label htmlFor="pg-apikey" className="block text-[12.5px] font-medium mb-1">
                Bearer API Key (tùy chọn)
              </label>
              <input
                id="pg-apikey"
                type="password"
                value={pgApiKey}
                onChange={(e) => setPgApiKey(e.target.value)}
                placeholder="cm_live_... hoặc bỏ trống dùng phiên hiện tại"
                className="cm-input font-mono-num"
              />
            </div>
          </div>

          {pgEndpoint.startsWith('POST ') && (
            <div>
              <label htmlFor="pg-body" className="block text-[12.5px] font-medium mb-1">
                JSON Request Body
              </label>
              <textarea
                id="pg-body"
                rows={6}
                value={pgBody}
                onChange={(e) => setPgBody(e.target.value)}
                className="w-full rounded-[6px] border border-black/[0.13] p-3 text-[12.5px] font-mono-num focus:outline-none focus:border-[#09090B]"
              />
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={pgRunning} className="cm-btn cm-btn-primary">
              <Terminal className="w-3.5 h-3.5" />
              {pgRunning ? 'Đang gửi...' : 'Thực thi Request'}
            </button>
          </div>

          {pgResult && (
            <div className="space-y-2.5 pt-2 border-t border-black/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={pgResult.status >= 200 && pgResult.status < 400 ? 'green' : 'rose'}>
                    HTTP {pgResult.status}
                  </Badge>
                  <Badge tone="slate">{pgResult.latencyMs} ms</Badge>
                  {pgResult.rateLimitHeader && (
                    <Badge tone="blue">Quota còn {pgResult.rateLimitHeader}</Badge>
                  )}
                </div>
                <CopyButton
                  value={pgResult.body}
                  label="Sao chép JSON"
                  size="xs"
                  onCopied={(ok) =>
                    onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép JSON' : 'Lỗi sao chép')
                  }
                />
              </div>
              <pre className="rounded-[8px] bg-[#09090B] text-zinc-100 p-4 text-[12px] font-mono-num overflow-x-auto max-h-96 leading-relaxed">
                {pgResult.body}
              </pre>
            </div>
          )}
        </form>
      )}

      {subTab === 'openapi' && (
        <div className="space-y-5 min-w-0">
          <div className="cm-panel p-5 space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandIcon id="postman" size={18} tile />
                <div>
                  <h3 className="text-[14px] font-semibold text-[#09090B]">
                    Đặc tả OpenAPI 3.1.0
                  </h3>
                  <p className="text-[12.5px] text-[#71717A] mt-0.5">
                    Import trực tiếp vào Postman, Insomnia hoặc trình sinh SDK tự động.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/v1/openapi.json"
                  target="_blank"
                  rel="noreferrer"
                  className="cm-btn cm-btn-secondary h-8 text-[12px]"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Mở JSON
                </a>
                <CopyButton
                  value={openApiUrl}
                  label="Sao chép URL"
                  variant="dark"
                  size="sm"
                  onCopied={(ok) =>
                    onNotify(
                      ok ? 'success' : 'error',
                      ok ? 'Đã sao chép OpenAPI URL' : 'Lỗi sao chép'
                    )
                  }
                />
              </div>
            </div>

            {loadingSpec ? (
              <p className="text-[12.5px] text-[#71717A]">Đang tải danh sách endpoint...</p>
            ) : (
              <div className="divide-y divide-black/[0.06] border border-black/[0.08] rounded-[8px] overflow-hidden">
                {openApiPaths.map((ep) => (
                  <div
                    key={ep.path}
                    className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px] bg-white"
                  >
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      <Badge tone="green">{ep.methods.join(' / ')}</Badge>
                      <code className="font-mono-num font-semibold text-[#09090B]">{ep.path}</code>
                      <span className="text-[#52525B]">{ep.summary}</span>
                    </div>
                    {ep.scope && (
                      <code className="font-mono-num text-[11px] bg-[#FAFAFA] px-2 py-0.5 rounded-[5px] border border-black/[0.08] text-[#52525B]">
                        {ep.scope}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cm-panel overflow-hidden min-w-0">
            <div className="px-5 py-3.5 border-b border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-[#09090B]">Mã mẫu tích hợp</h3>
                  <div className="hidden sm:flex items-center gap-1.5">
                    <BrandIcon id="nodejs" size={14} />
                    <BrandIcon id="typescript" size={14} />
                    <BrandIcon id="telegram" size={14} />
                    <BrandIcon id="php" size={14} />
                    <BrandIcon id="python" size={14} />
                  </div>
                </div>
                <p className="text-[12px] text-[#71717A]">
                  Xác thực chữ ký <code className="font-mono-num">X-Comey-Signature</code> hoặc gọi
                  API trực tiếp.
                </p>
              </div>
              <SegmentedControl
                size="sm"
                value={lang}
                onChange={setLang}
                ariaLabel="Ngôn ngữ lập trình"
                options={[
                  { value: 'node', label: 'Node.js' },
                  { value: 'telegram', label: 'grammY Bot' },
                  { value: 'php', label: 'PHP' },
                  { value: 'python', label: 'Python' },
                ]}
              />
            </div>
            <div className="relative">
              <div className="absolute right-4 top-4 z-10">
                <CopyButton
                  value={snippet}
                  label="Sao chép mã"
                  variant="dark"
                  onCopied={(ok) =>
                    onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép code mẫu' : 'Lỗi sao chép')
                  }
                />
              </div>
              <pre className="p-5 pt-14 sm:pt-5 bg-[#09090B] text-zinc-100 text-[12px] font-mono-num overflow-x-auto leading-relaxed">
                {snippet}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Create API Key Drawer */}
      <SheetDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        size="lg"
        title="Tạo API Key phân quyền"
        subtitle="Cấu hình nhóm quyền RBAC, giới hạn tốc độ RPM và danh sách IP được phép."
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateDrawerOpen(false)}
              className="cm-btn cm-btn-secondary"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              form="dev-create-key-form"
              disabled={creating}
              className="cm-btn cm-btn-primary"
            >
              {creating ? 'Đang tạo...' : 'Khởi tạo Key'}
            </button>
          </div>
        }
      >
        <form id="dev-create-key-form" onSubmit={handleCreateKey} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dev-key-name" className="block text-[12.5px] font-medium mb-1">
                Tên API Key
              </label>
              <input
                id="dev-key-name"
                type="text"
                required
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Shop Telegram Bot"
                className="cm-input"
              />
            </div>
            <div>
              <label htmlFor="dev-key-preset" className="block text-[12.5px] font-medium mb-1">
                Nhóm quyền nhanh
              </label>
              <select
                id="dev-key-preset"
                value={preset}
                onChange={(e) => handleSelectPreset(e.target.value as PresetKey)}
                className="cm-input font-medium"
              >
                {Object.entries(PRESET_DEFS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
                <option value="custom">Tùy chỉnh chi tiết</option>
              </select>
            </div>
          </div>

          {preset !== 'custom' && (
            <div className="rounded-[8px] bg-[#FAFAFA] border border-black/[0.08] px-3.5 py-2.5 text-[12px] text-[#52525B]">
              {PRESET_DEFS[preset].hint}
            </div>
          )}

          {scopes.includes('*') && (
            <div className="rounded-[8px] bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <span>
                Toàn quyền (*) cho phép chỉnh sửa tài khoản ngân hàng và định tuyến webhook. Nếu
                chỉ cần thu hộ, hãy chọn nhóm Bot &amp; Website bán hàng.
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dev-key-rpm" className="block text-[12.5px] font-medium mb-1">
                Giới hạn tốc độ (req/phút)
              </label>
              <input
                id="dev-key-rpm"
                type="number"
                min={10}
                max={600}
                value={rateLimitRpm}
                onChange={(e) =>
                  setRateLimitRpm(Math.max(10, Math.min(600, Number(e.target.value) || 120)))
                }
                className="cm-input font-mono-num"
              />
            </div>
            <div>
              <label htmlFor="dev-key-expiry" className="block text-[12.5px] font-medium mb-1">
                Thời hạn hiệu lực
              </label>
              <select
                id="dev-key-expiry"
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value as 'none' | '30' | '90' | '365')}
                className="cm-input"
              >
                <option value="30">30 ngày</option>
                <option value="90">90 ngày</option>
                <option value="365">1 năm</option>
                <option value="none">Không hết hạn</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dev-key-ips" className="block text-[12.5px] font-medium mb-1">
              IP Allowlist (tùy chọn, phân tách dấu phẩy)
            </label>
            <input
              id="dev-key-ips"
              type="text"
              value={allowedIpsText}
              onChange={(e) => setAllowedIpsText(e.target.value)}
              placeholder="203.0.113.10, 103.56.15.0/24"
              className="cm-input font-mono-num"
            />
          </div>

          <div>
            <label htmlFor="dev-key-desc" className="block text-[12.5px] font-medium mb-1">
              Ghi chú mục đích
            </label>
            <input
              id="dev-key-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Backend ứng dụng thanh toán"
              className="cm-input"
            />
          </div>

          <div className="space-y-2">
            <div className="text-[12.5px] font-medium text-[#09090B]">
              Phạm vi quyền ({scopes.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_SCOPES.map((s) => {
                const checked = scopes.includes('*') ? s.id === '*' : scopes.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`min-h-[38px] flex items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-[12px] cursor-pointer transition-colors duration-150 ${
                      checked
                        ? 'bg-[#ECFDF5] border-[#047857] text-[#047857] font-medium'
                        : 'bg-white border-black/[0.08] text-[#52525B]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setPreset('custom');
                        toggleScope(scopes, setScopes, s.id);
                      }}
                      className="h-3.5 w-3.5 accent-[#047857] shrink-0"
                    />
                    <span className="truncate">{s.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <label
            htmlFor="dev-key-is-test"
            className="flex items-start gap-2.5 rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] p-3 text-[12.5px] text-[#52525B] cursor-pointer"
          >
            <input
              id="dev-key-is-test"
              type="checkbox"
              checked={isTest}
              onChange={(e) => setIsTest(e.target.checked)}
              className="h-4 w-4 mt-0.5 accent-[#047857] shrink-0"
            />
            <span>
              <span className="font-semibold text-[#09090B] block">Khóa Sandbox (cm_test_)</span>
              Cô lập hoàn toàn khỏi giao dịch và webhook thật.
            </span>
          </label>
        </form>
      </SheetDrawer>

      {/* Edit Key Drawer */}
      <SheetDrawer
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        size="lg"
        title={editTarget ? `Chỉnh sửa: ${editTarget.name}` : 'Chỉnh sửa API Key'}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="cm-btn cm-btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="dev-edit-key-form"
              disabled={savingEdit}
              className="cm-btn cm-btn-primary"
            >
              {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        }
      >
        {editTarget && (
          <form id="dev-edit-key-form" onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-key-name" className="block text-[12.5px] font-medium mb-1">
                  Tên Key
                </label>
                <input
                  id="edit-key-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="cm-input"
                />
              </div>
              <div>
                <label htmlFor="edit-key-rpm" className="block text-[12.5px] font-medium mb-1">
                  Rate Limit (10–600 req/phút)
                </label>
                <input
                  id="edit-key-rpm"
                  type="number"
                  min={10}
                  max={600}
                  value={editRpm}
                  onChange={(e) =>
                    setEditRpm(Math.max(10, Math.min(600, Number(e.target.value) || 120)))
                  }
                  className="cm-input font-mono-num"
                />
              </div>
            </div>

            <div>
              <label htmlFor="edit-key-ips" className="block text-[12.5px] font-medium mb-1">
                IP Allowlist
              </label>
              <input
                id="edit-key-ips"
                type="text"
                value={editIps}
                onChange={(e) => setEditIps(e.target.value)}
                className="cm-input font-mono-num"
              />
            </div>

            <div>
              <label htmlFor="edit-key-desc" className="block text-[12.5px] font-medium mb-1">
                Ghi chú
              </label>
              <input
                id="edit-key-desc"
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="cm-input"
              />
            </div>

            <div className="space-y-2">
              <div className="text-[12.5px] font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#047857]" /> Phạm vi quyền
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map((s) => {
                  const checked = editScopes.includes('*')
                    ? s.id === '*'
                    : editScopes.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`min-h-[38px] flex items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-[12px] cursor-pointer ${
                        checked
                          ? 'bg-[#ECFDF5] border-[#047857] text-[#047857] font-medium'
                          : 'bg-white border-black/[0.08] text-[#52525B]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleScope(editScopes, setEditScopes, s.id)}
                        className="h-3.5 w-3.5 accent-[#047857] shrink-0"
                      />
                      <span className="truncate">{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </form>
        )}
      </SheetDrawer>

      <ConfirmModal
        open={Boolean(rotateTarget)}
        title="Cấp lại API Key mới"
        description={
          rotateTarget
            ? `Key cũ "${rotateTarget.key_prefix}..." sẽ ngừng hiệu lực ngay khi cấp key mới.`
            : ''
        }
        confirmLabel="Cấp key mới"
        onConfirm={handleRotateConfirmed}
        onClose={() => setRotateTarget(null)}
      />

      <ConfirmModal
        open={Boolean(revokeTarget)}
        title="Thu hồi vĩnh viễn API Key"
        description={
          revokeTarget
            ? `API Key "${revokeTarget.name}" (${revokeTarget.key_prefix}...) sẽ bị hủy vĩnh viễn.`
            : ''
        }
        confirmLabel="Thu hồi Key"
        destructive
        onConfirm={handleRevokeConfirmed}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}
