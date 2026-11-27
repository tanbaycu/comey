import { ArrowRight, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyItem, BankAccount, RoutingRule } from '../lib/types';
import { Badge } from './Badge';
import { BankLogo } from './BankEmblem';
import { BrandIcon } from './BrandIcon';
import { CopyButton } from './CopyButton';

interface HealthProbeState {
  status: 'checking' | 'online' | 'error';
  latencyMs: number | null;
  service: string | null;
  checkedAt: string | null;
}

export function DeployControlDeck({
  accounts,
  rules,
  apiKeys,
  onNavigate,
  onOpenCreateKey,
  onNotify,
}: {
  accounts: BankAccount[];
  rules: RoutingRule[];
  apiKeys: ApiKeyItem[];
  onNavigate?: (tab: string) => void;
  onOpenCreateKey?: () => void;
  onNotify?: (kind: 'success' | 'error', text: string) => void;
}) {
  const [probe, setProbe] = useState<HealthProbeState>({
    status: 'checking',
    latencyMs: null,
    service: null,
    checkedAt: null,
  });

  const runProbe = useCallback(async () => {
    setProbe((prev) => ({ ...prev, status: 'checking' }));
    const t0 = performance.now();
    try {
      const resp = await fetch('/health', { cache: 'no-store' });
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      const data = (await resp.json().catch(() => null)) as {
        ok?: boolean;
        service?: string;
        timestamp?: string;
      } | null;
      if (resp.ok && data?.ok) {
        setProbe({
          status: 'online',
          latencyMs,
          service: data.service ?? 'comey-cloud',
          checkedAt: data.timestamp ?? new Date().toISOString(),
        });
      } else {
        setProbe({
          status: 'error',
          latencyMs,
          service: null,
          checkedAt: new Date().toISOString(),
        });
      }
    } catch {
      setProbe({
        status: 'error',
        latencyMs: null,
        service: null,
        checkedAt: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pay.comey.dev';
  const isProdHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const strictCount = accounts.filter((a) => a.strictAuth).length;
  const activeKeyCount = apiKeys.filter((k) => k.enabled && k.status === 'active').length;
  const sampleBanks = accounts.length > 0 ? accounts.slice(0, 2).map((a) => a.bankCode) : ['CAKE', 'VCB'];

  const readinessItems = [
    {
      id: 'health',
      done: probe.status === 'online',
      title: 'Worker & D1 Online',
      desc:
        probe.status === 'online'
          ? `Edge đang phản hồi ổn định (${probe.latencyMs} ms)`
          : 'Đang kiểm tra hoặc chưa kết nối được /health',
      actionLabel: 'Đo lại',
      onAction: () => void runProbe(),
    },
    {
      id: 'banks',
      done: accounts.length > 0,
      title: 'Ngân hàng & Strict DKIM',
      desc:
        accounts.length > 0
          ? `${accounts.length} tài khoản (${strictCount} bật Strict DKIM)`
          : 'Thêm tài khoản nhận tiền để cấp email chuyển tiếp',
      actionLabel: 'Ngân hàng',
      onAction: () => onNavigate?.('accounts'),
    },
    {
      id: 'routing',
      done: rules.length > 0,
      title: 'Kênh định tuyến đầu ra',
      desc:
        rules.length > 0
          ? `${rules.filter((r) => r.enabled).length}/${rules.length} kênh đang bật`
          : 'Tạo ít nhất 1 kênh Telegram, Discord, Sheets hoặc Webhook',
      actionLabel: 'Định tuyến',
      onAction: () => onNavigate?.('routing'),
    },
    {
      id: 'apikeys',
      done: activeKeyCount > 0,
      title: 'API Key phân quyền RBAC',
      desc:
        activeKeyCount > 0
          ? `${activeKeyCount} key đang hoạt động an toàn`
          : 'Cấp API Key phạm vi tối thiểu cho backend/bot',
      actionLabel: 'Tạo Key',
      onAction: () => onOpenCreateKey?.(),
    },
    {
      id: 'https',
      done: isProdHttps,
      title: 'Production HTTPS Domain',
      desc: isProdHttps
        ? `Đang chạy qua tên miền HTTPS (${origin})`
        : 'Hiện tại là Local Studio — dùng bộ cấu hình bên dưới để đưa lên Cloudflare',
      actionLabel: isProdHttps ? 'Đã bật' : 'Xem CLI',
      onAction: () => {
        document.getElementById('deploy-worker-name')?.focus();
      },
    },
  ];

  const doneCount = readinessItems.filter((i) => i.done).length;
  const pct = Math.round((doneCount / readinessItems.length) * 100);

  return (
    <div className="space-y-5 min-w-0">
      {/* Live Edge Health Strip */}
      <div className="cm-panel cm-studio-surface p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                probe.status === 'online'
                  ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                  : probe.status === 'checking'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-rose-50 border-rose-200 text-[#DC2626]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  probe.status === 'online'
                    ? 'bg-[#10B981] cm-live-dot'
                    : probe.status === 'checking'
                      ? 'bg-amber-500'
                      : 'bg-[#DC2626]'
                }`}
              />
              {probe.status === 'online'
                ? 'Edge Online'
                : probe.status === 'checking'
                  ? 'Đang đo Edge...'
                  : 'Mất kết nối /health'}
            </span>

            <Badge tone={isProdHttps ? 'green' : 'slate'}>
              {isProdHttps ? 'Production Edge' : 'Local Studio'}
            </Badge>

            {probe.latencyMs !== null && (
              <span className="font-mono-num text-[11.5px] font-semibold text-[#09090B] bg-white border border-black/[0.08] rounded-[6px] px-2 py-0.5">
                {probe.latencyMs} ms
              </span>
            )}

            {probe.service && (
              <span className="font-mono-num text-[11.5px] text-[#52525B] bg-white border border-black/[0.08] rounded-[6px] px-2 py-0.5">
                {probe.service}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-[12.5px] text-[#71717A]">Endpoint hiện tại:</span>
            <code className="font-mono-num text-[12.5px] font-semibold text-[#09090B]">
              {origin}
            </code>
            <CopyButton
              value={`${origin}/health`}
              size="xs"
              variant="ghost"
              onCopied={(ok) =>
                onNotify?.(
                  ok ? 'success' : 'error',
                  ok ? 'Đã sao chép URL /health' : 'Không thể sao chép'
                )
              }
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runProbe()}
          disabled={probe.status === 'checking'}
          className="cm-btn cm-btn-secondary shrink-0"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${probe.status === 'checking' ? 'animate-spin' : ''}`}
          />
          Kiểm tra Edge
        </button>
      </div>

      {/* 4-Stage Horizontal Deployment Topology */}
      <div className="grid gap-3 lg:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] items-stretch">
        <button
          type="button"
          onClick={() => onNavigate?.('accounts')}
          className="cm-panel cm-card-interactive p-4 text-left flex flex-col justify-between gap-3 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#71717A]">01. Nguồn tiền</span>
            <div className="flex items-center -space-x-1">
              {sampleBanks.map((code, idx) => (
                <BankLogo key={`${code}-${idx}`} code={code} size="xs" />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[#09090B]">Ngân hàng Việt Nam</div>
            <div className="text-[12px] text-[#71717A] mt-0.5">
              {accounts.length > 0
                ? `${accounts.length} tài khoản đã gắn`
                : 'Hỗ trợ 12 ngân hàng VietQR'}
            </div>
          </div>
        </button>

        <div className="hidden lg:flex items-center justify-center" aria-hidden="true">
          <svg viewBox="0 0 32 16" className="w-6 h-4">
            <line
              x1="0"
              y1="8"
              x2="32"
              y2="8"
              stroke="#047857"
              strokeWidth="1.5"
              className="comey-signal-line"
            />
          </svg>
        </div>

        <button
          type="button"
          onClick={() => onNavigate?.('accounts')}
          className="cm-panel cm-card-interactive p-4 text-left flex flex-col justify-between gap-3 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#71717A]">02. Thu thập</span>
            <BrandIcon id="gmail" size={16} tile label="Gmail" />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[#09090B]">
              Email &amp; Apps Script
            </div>
            <div className="text-[12px] text-[#71717A] mt-0.5">
              {strictCount}/{accounts.length} Strict DKIM chống giả mạo
            </div>
          </div>
        </button>

        <div className="hidden lg:flex items-center justify-center" aria-hidden="true">
          <svg viewBox="0 0 32 16" className="w-6 h-4">
            <line
              x1="0"
              y1="8"
              x2="32"
              y2="8"
              stroke="#047857"
              strokeWidth="1.5"
              className="comey-signal-line"
            />
          </svg>
        </div>

        <button
          type="button"
          onClick={() => void runProbe()}
          className="cm-panel cm-card-interactive p-4 text-left flex flex-col justify-between gap-3 cursor-pointer border-[#09090B]/15 bg-[#FAFAFA]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#047857]">03. Edge Core</span>
            <div className="flex items-center gap-1">
              <BrandIcon id="cloudflare-workers" size={15} tile label="Workers" />
              <BrandIcon id="sqlite" size={15} tile label="D1" />
            </div>
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[#09090B]">
              Cloudflare Workers + D1
            </div>
            <div className="font-mono-num text-[12px] text-[#047857] mt-0.5">
              {probe.status === 'online' && probe.latencyMs !== null
                ? `Edge Online (${probe.latencyMs} ms)`
                : 'Sẵn sàng đối soát'}
            </div>
          </div>
        </button>

        <div className="hidden lg:flex items-center justify-center" aria-hidden="true">
          <svg viewBox="0 0 32 16" className="w-6 h-4">
            <line
              x1="0"
              y1="8"
              x2="32"
              y2="8"
              stroke="#047857"
              strokeWidth="1.5"
              className="comey-signal-line"
            />
          </svg>
        </div>

        <button
          type="button"
          onClick={() => onNavigate?.('routing')}
          className="cm-panel cm-card-interactive p-4 text-left flex flex-col justify-between gap-3 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#71717A]">04. Phân phối</span>
            <div className="flex items-center gap-1">
              <BrandIcon id="telegram" size={15} tile label="Telegram" />
              <BrandIcon id="google-sheets" size={15} tile label="Sheets" />
            </div>
          </div>
          <div>
            <div className="text-[13.5px] font-semibold text-[#09090B]">
              Webhook, Chat &amp; POS
            </div>
            <div className="text-[12px] text-[#71717A] mt-0.5">
              {rules.length > 0 ? `${rules.length} kênh định tuyến` : '0đ phí trung gian'}
            </div>
          </div>
        </button>
      </div>

      {/* 5-Step Production Go-Live Readiness Matrix */}
      <div className="cm-panel overflow-hidden">
        <div className="px-5 py-3.5 bg-[#FAFAFA] border-b border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-[#09090B]">
              Mức độ sẵn sàng Go-Live
            </span>
            <span className="font-mono-num text-[11.5px] font-semibold text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 rounded-[5px]">
              {doneCount}/{readinessItems.length} đạt ({pct}%)
            </span>
          </div>

          <div className="w-36 h-2 rounded-full bg-[#EEF0F3] overflow-hidden">
            <div
              style={{ width: `${pct}%`, transition: 'width 260ms var(--ease-out)' }}
              className="h-full rounded-full bg-[#047857]"
            />
          </div>
        </div>

        <div className="divide-y divide-black/[0.06]">
          {readinessItems.map((item) => (
            <div
              key={item.id}
              className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors duration-100"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {item.done ? (
                  <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-4 h-4 text-[#A1A1AA] shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#09090B]">{item.title}</div>
                  <div className="text-[12px] text-[#71717A] mt-0.5">{item.desc}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={item.onAction}
                className="cm-btn cm-btn-secondary h-8 min-h-[32px] px-3 text-[12px] shrink-0"
              >
                <span>{item.actionLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
