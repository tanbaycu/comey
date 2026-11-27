import {
  Bank,
  QrCode as PhQrCode,
  ShareNetwork,
  ShieldWarning,
  SpeakerHigh,
  TrendUp,
} from '@phosphor-icons/react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  Play,
  QrCode,
  Rocket,
  Webhook,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { BankEmblem, BankLogo } from '../components/BankEmblem';
import { BrandIcon, ChannelBadgeIcon } from '../components/BrandIcon';
import type { QuickActionId } from '../components/CommandPalette';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { formatDateTime, formatVnd } from '../lib/format';
import type {
  ApiKeyItem,
  BankAccount,
  PaymentSessionItem,
  QuarantineItem,
  RoutingRule,
  TransactionItem,
  UserInfo,
  WebhookDeliveryItem,
  WebhookPayloadFormat,
  WorkspaceInfo,
} from '../lib/types';

function buildMonotonePath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  let d = `M ${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const cx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cx},${p0.y.toFixed(1)} ${cx},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}

function CashflowSparkline({
  transactions,
  onSimulate,
}: {
  transactions: TransactionItem[];
  onSimulate?: () => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const points = useMemo(() => {
    const incoming = transactions
      .filter((t) => t.direction === 'in')
      .slice(0, 14)
      .reverse();
    if (incoming.length === 0) return [];
    const maxVal = Math.max(...incoming.map((t) => t.amount), 1);
    const w = 520;
    const h = 112;
    const padX = 10;
    const padY = 14;
    return incoming.map((t, idx) => {
      const x =
        incoming.length === 1
          ? w / 2
          : padX + (idx / (incoming.length - 1)) * (w - padX * 2);
      const y = h - padY - (t.amount / maxVal) * (h - padY * 2);
      return { x, y, amount: t.amount, tx: t };
    });
  }, [transactions]);

  const maxAmount = useMemo(() => {
    const inc = transactions.filter((t) => t.direction === 'in');
    return inc.length > 0 ? Math.max(...inc.map((t) => t.amount)) : 0;
  }, [transactions]);

  const avgAmount = useMemo(() => {
    const inc = transactions.filter((t) => t.direction === 'in');
    if (inc.length === 0) return 0;
    return Math.round(inc.reduce((acc, t) => acc + t.amount, 0) / inc.length);
  }, [transactions]);

  const latestAmount = useMemo(() => {
    const first = transactions.find((t) => t.direction === 'in');
    return first?.amount ?? 0;
  }, [transactions]);

  if (points.length === 0) {
    return (
      <div className="cm-panel p-5 flex flex-col justify-between min-h-[244px] h-full">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#09090B]">Biến động dòng tiền vào</h2>
            <p className="text-[12.5px] text-[#71717A] mt-0.5">
              Đường cong tự cập nhật theo thời gian thực khi có giao dịch hoặc mô phỏng.
            </p>
          </div>
          <Badge tone="slate">Đang chờ dữ liệu</Badge>
        </div>

        <div className="relative my-3 h-28 rounded-[10px] border border-black/[0.06] bg-gradient-to-b from-[#F5F6F7] to-white overflow-hidden flex items-center justify-center">
          <svg
            viewBox="0 0 520 112"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="cmGhostArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#047857" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="30" x2="520" y2="30" stroke="rgba(9,9,11,0.04)" strokeWidth="1" />
            <line x1="0" y1="62" x2="520" y2="62" stroke="rgba(9,9,11,0.04)" strokeWidth="1" />
            <line x1="0" y1="90" x2="520" y2="90" stroke="rgba(9,9,11,0.04)" strokeWidth="1" />
            <path
              d="M 0,88 C 75,86 115,54 175,60 C 235,66 265,34 335,40 C 395,45 435,20 520,24 L 520,112 L 0,112 Z"
              fill="url(#cmGhostArea)"
            />
            <path
              d="M 0,88 C 75,86 115,54 175,60 C 235,66 265,34 335,40 C 395,45 435,20 520,24"
              fill="none"
              stroke="rgba(4,120,87,0.28)"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
          </svg>
          <div className="relative z-10 flex flex-wrap items-center justify-center gap-3 px-4">
            <span className="text-[12.5px] font-medium text-[#52525B] bg-white/90 px-3 py-1 rounded-full border border-black/[0.06]">
              Chưa có dòng tiền vào
            </span>
            {onSimulate ? (
              <button
                type="button"
                onClick={onSimulate}
                className="cm-btn cm-btn-primary cm-btn-sm"
              >
                <Play className="w-3 h-3" /> Mô phỏng +80.000đ
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-black/[0.06] text-[12px]">
          <div>
            <span className="text-[#71717A]">Mới nhất</span>
            <div className="font-mono-num font-semibold text-[#09090B]">0đ</div>
          </div>
          <div>
            <span className="text-[#71717A]">Trung bình</span>
            <div className="font-mono-num font-semibold text-[#09090B]">0đ</div>
          </div>
          <div>
            <span className="text-[#71717A]">Cao nhất</span>
            <div className="font-mono-num font-semibold text-[#09090B]">0đ</div>
          </div>
        </div>
      </div>
    );
  }

  const activePoint =
    (hoveredId ? points.find((p) => p.tx.id === hoveredId) : null) ??
    points[points.length - 1]!;
  const linePath = buildMonotonePath(points);
  const firstPt = points[0]!;
  const lastPt = points[points.length - 1]!;
  const areaPath =
    points.length === 1
      ? ''
      : `${linePath} L ${lastPt.x.toFixed(1)},112 L ${firstPt.x.toFixed(1)},112 Z`;

  return (
    <div
      className="cm-panel p-5 flex flex-col justify-between gap-3.5 min-w-0"
      onMouseLeave={() => setHoveredId(null)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-[#09090B]">Biến động dòng tiền vào</h2>
          <p className="text-[12.5px] text-[#71717A] mt-0.5">
            {points.length} giao dịch tiền vào gần nhất trên hệ thống
          </p>
        </div>
        <div className="flex items-center gap-5 text-right">
          <div>
            <div className="text-[11px] text-[#71717A]">Cao nhất</div>
            <div className="font-mono-num text-[12.5px] font-semibold text-[#09090B]">
              {formatVnd(maxAmount)}
            </div>
          </div>
          <div className="w-px h-6 bg-black/[0.08]" aria-hidden="true" />
          <div>
            <div className="text-[11px] text-[#71717A]">Trung bình</div>
            <div className="font-mono-num text-[12.5px] font-semibold text-[#09090B]">
              {formatVnd(avgAmount)}
            </div>
          </div>
          <div className="w-px h-6 bg-black/[0.08]" aria-hidden="true" />
          <div>
            <div className="text-[11px] text-[#71717A]">Mới nhất</div>
            <div className="font-mono-num text-[12.5px] font-semibold text-[#047857]">
              +{formatVnd(latestAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Selected / Hovered Data Point Readout Pill */}
      <div className="rounded-[8px] border border-black/[0.06] bg-[#FAFAFA] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          <IdentityAvatar
            seed={activePoint.tx.content || activePoint.tx.bankTxId}
            size="xs"
          />
          <BankEmblem code={activePoint.tx.bankCode} size="sm" />
          <span className="font-mono-num font-medium text-[#09090B] truncate">
            {activePoint.tx.matchedOrderCode || activePoint.tx.content || activePoint.tx.bankTxId}
          </span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="font-mono-num font-semibold text-[#047857]">
            +{formatVnd(activePoint.amount)}
          </span>
          <span className="text-[11px] text-[#71717A]">
            {formatDateTime(activePoint.tx.occurredAt)}
          </span>
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg viewBox="0 0 520 112" className="w-full h-[112px]" aria-label="Biểu đồ dòng tiền">
          <defs>
            <linearGradient id="cmCashGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#047857" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="28" x2="520" y2="28" stroke="rgba(9,9,11,0.05)" strokeWidth="1" />
          <line x1="0" y1="68" x2="520" y2="68" stroke="rgba(9,9,11,0.05)" strokeWidth="1" />
          <line x1="0" y1="108" x2="520" y2="108" stroke="rgba(9,9,11,0.06)" strokeWidth="1" />
          {areaPath && <path d={areaPath} fill="url(#cmCashGrad)" />}
          {points.length > 1 && (
            <path
              d={linePath}
              fill="none"
              stroke="#047857"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <line
            x1={activePoint.x}
            y1="10"
            x2={activePoint.x}
            y2="108"
            stroke="rgba(4,120,87,0.22)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          {points.map((pt) => {
            const isSel = pt.tx.id === activePoint.tx.id;
            return (
              <g
                key={pt.tx.id}
                tabIndex={0}
                role="button"
                aria-label={`${pt.tx.bankCode} +${formatVnd(pt.amount)}`}
                onMouseEnter={() => setHoveredId(pt.tx.id)}
                onFocus={() => setHoveredId(pt.tx.id)}
                className="cursor-pointer focus:outline-none"
              >
                <circle cx={pt.x} cy={pt.y} r={11} fill="transparent" />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSel ? 5 : 3}
                  fill={isSel ? '#047857' : '#FFFFFF'}
                  stroke="#047857"
                  strokeWidth={isSel ? 2.5 : 2}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const QUICK_BANK_CODES = ['CAKE', 'MB', 'VCB', 'TECHCOMBANK', 'TIMO', 'ACB'] as const;

export function OverviewPage({
  user,
  workspace,
  accounts,
  rules,
  transactions,
  sessions,
  deliveries,
  quarantine,
  apiKeys = [],
  onNavigate,
  onQuickAction,
  onOpenBankWithCode,
}: {
  user?: UserInfo | null;
  workspace?: WorkspaceInfo | null;
  accounts: BankAccount[];
  rules: RoutingRule[];
  transactions: TransactionItem[];
  sessions: PaymentSessionItem[];
  deliveries: WebhookDeliveryItem[];
  quarantine: QuarantineItem[];
  apiKeys?: ApiKeyItem[];
  onNavigate: (tab: string) => void;
  onQuickAction?: (action: QuickActionId) => void;
  onOpenBankWithCode?: (bankCode: string) => void;
  onOpenRuleWithFormat?: (fmt: WebhookPayloadFormat) => void;
}) {
  const [edgeLatencyMs, setEdgeLatencyMs] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const t0 = performance.now();
    void fetch('/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && (data as { ok?: boolean }).ok) {
          setEdgeLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const activeKeyCount = apiKeys.filter((k) => k.enabled && k.status === 'active').length;
  const realIncome = transactions
    .filter((t) => !t.isTest && t.direction === 'in')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalTx = transactions.length;
  const paidSessions = sessions.filter((s) => s.status === 'paid').length;
  const pendingSessions = sessions.filter((s) => s.status === 'pending').length;
  const retryingWebhooks = deliveries.filter(
    (d) => d.status === 'retrying' || d.status === 'failed'
  ).length;
  const verifiedBanks = accounts.filter((a) => a.strictAuth).length;

  const steps = [
    {
      done: accounts.length > 0,
      label: 'Thêm tài khoản ngân hàng nhận tiền',
      action: () => onNavigate('accounts'),
    },
    {
      done: accounts.some(
        (a) => a.forwardingStatus === 'verified' || Boolean(a.appsScriptUrl)
      ),
      label: 'Kết nối chuyển tiếp email hoặc Google Apps Script',
      action: () => onNavigate('accounts'),
    },
    {
      done: rules.length > 0,
      label: 'Cấu hình kênh nhận Webhook, Telegram hoặc Google Sheets',
      action: () => onNavigate('routing'),
    },
    {
      done: transactions.length > 0 || sessions.length > 0,
      label: 'Mô phỏng giao dịch hoặc khởi tạo mã VietQR',
      action: () => onNavigate('transactions'),
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allReady = completedCount === steps.length;
  const [checklistOpen, setChecklistOpen] = useState(!allReady);

  const uniqueConnectedBanks = useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((a) => {
      const code = a.bankCode.toUpperCase();
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });
  }, [accounts]);

  return (
    <div className="space-y-6 min-w-0">
      {/* Executive Bento Command Banner */}
      <section className="cm-panel cm-studio-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('developers')}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-[#047857] hover:bg-emerald-100/70 transition-colors duration-150 cursor-pointer"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] cm-live-dot" />
                {edgeLatencyMs !== null ? `Edge Online (${edgeLatencyMs} ms)` : 'Edge Ready'}
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-white border border-black/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-[#52525B]">
                Strict DKIM
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white border border-black/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-[#52525B]">
                {activeKeyCount > 0 ? `${activeKeyCount} API Key` : '0đ phí giao dịch'}
              </span>
            </div>

            <h2 className="mt-2.5 text-[21px] sm:text-[23px] font-semibold tracking-[-0.03em] text-[#09090B]">
              {user?.name
                ? `Xin chào, ${user.name}`
                : workspace?.name
                  ? workspace.name
                  : 'Trung tâm đối soát Comey'}
            </h2>
            <p className="text-[13px] text-[#71717A] mt-0.5 max-w-[60ch]">
              Điều phối dòng tiền VietQR, chuyển tiếp kênh webhook đa nền tảng và loa thu ngân ESP32 từ một bảng điều khiển hợp nhất.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto max-w-full">
            <button
              type="button"
              onClick={() =>
                onQuickAction ? onQuickAction('dynamic-qr') : onNavigate('sessions')
              }
              className="cm-btn cm-btn-secondary"
            >
              <QrCode className="w-3.5 h-3.5" /> Tạo ảnh VietQR
            </button>
            <button
              type="button"
              onClick={() =>
                onQuickAction ? onQuickAction('simulate-tx') : onNavigate('transactions')
              }
              className="cm-btn cm-btn-primary"
            >
              <Play className="w-3.5 h-3.5" /> Mô phỏng giao dịch
            </button>
          </div>
        </div>

        {/* Real Bank Logo Quick Dock */}
        <div className="mt-5 pt-4 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-[11.5px] font-semibold text-[#71717A] mr-1">
              {uniqueConnectedBanks.length > 0
                ? 'Ngân hàng đang kết nối:'
                : 'Kết nối nhanh ngân hàng:'}
            </span>
            {uniqueConnectedBanks.length > 0
              ? uniqueConnectedBanks.slice(0, 6).map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onNavigate('accounts')}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-black/[0.08] bg-white px-2 py-1 hover:border-black/[0.2] transition-colors duration-150 cursor-pointer"
                    title={`${acc.bankCode} ${acc.accountNumber}`}
                  >
                    <BankLogo code={acc.bankCode} size="xs" plate={false} />
                    <span className="font-mono-num text-[11px] font-medium text-[#52525B]">
                      {acc.accountNumber.slice(-4)}
                    </span>
                  </button>
                ))
              : QUICK_BANK_CODES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      onOpenBankWithCode ? onOpenBankWithCode(code) : onNavigate('accounts')
                    }
                    className="inline-flex items-center rounded-[8px] border border-black/[0.08] bg-white p-1 hover:border-[#047857]/45 transition-colors duration-150 cursor-pointer"
                    title={`Thêm nhanh ${code}`}
                  >
                    <BankLogo code={code} size="xs" plate={false} />
                  </button>
                ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('developers')}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#52525B] hover:text-[#09090B] cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5 text-[#047857]" /> Triển khai Cloudflare
            </button>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#047857] hover:underline cursor-pointer"
            >
              Xem đủ 12 ngân hàng <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* 4 Elevated Bento KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="cm-panel cm-card-interactive p-5 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
              <span className="truncate">Doanh thu đã đối soát</span>
              <span className="cm-kpi-badge cm-kpi-badge-emerald">
                <TrendUp size={15} weight="duotone" />
              </span>
            </div>
            <div className="mt-2.5 font-mono-num text-[24px] font-semibold tracking-[-0.025em] text-[#09090B] truncate">
              {formatVnd(realIncome)}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-black/[0.05] flex items-center justify-between text-[12px] text-[#71717A]">
            <span>{totalTx} giao dịch đã ghi nhận</span>
            <span className="font-medium text-[#047857]">Tự động</span>
          </div>
        </div>

        <div className="cm-panel cm-card-interactive p-5 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
              <span className="truncate">Tài khoản ngân hàng</span>
              <span className="cm-kpi-badge">
                <Bank size={15} weight="duotone" />
              </span>
            </div>
            <div className="mt-2.5 font-mono-num text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
              {accounts.length} tài khoản
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-black/[0.05] flex items-center justify-between text-[12px] text-[#71717A]">
            <span>{rules.length} luật định tuyến</span>
            <span className="font-medium text-[#09090B]">{verifiedBanks} Strict DKIM</span>
          </div>
        </div>

        <div className="cm-panel cm-card-interactive p-5 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
              <span className="truncate">Phiên thanh toán QR</span>
              <span className="cm-kpi-badge">
                <PhQrCode size={15} weight="duotone" />
              </span>
            </div>
            <div className="mt-2.5 font-mono-num text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
              {paidSessions} hoàn tất
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-black/[0.05] flex items-center justify-between text-[12px] text-[#71717A]">
            <span>{pendingSessions} phiên đang chờ</span>
            <span className="font-medium text-[#09090B]">VietQR 24/7</span>
          </div>
        </div>

        <div className="cm-panel cm-card-interactive p-5 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
              <span className="truncate">Cách ly &amp; Retry</span>
              <span
                className={`cm-kpi-badge ${
                  quarantine.length > 0 || retryingWebhooks > 0
                    ? 'bg-rose-50 border-rose-200 text-[#DC2626]'
                    : ''
                }`}
              >
                <ShieldWarning size={15} weight="duotone" />
              </span>
            </div>
            <div className="mt-2.5 font-mono-num text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
              {quarantine.length} cách ly
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-black/[0.05] flex items-center justify-between text-[12px] text-[#71717A]">
            <span>{retryingWebhooks} chuyển tiếp retry</span>
            <span className="font-medium text-[#047857]">
              {quarantine.length === 0 && retryingWebhooks === 0 ? 'An toàn' : 'Cần kiểm tra'}
            </span>
          </div>
        </div>
      </div>

      {/* Sparkline & Quick Infrastructure Navigation */}
      <div className="grid gap-5 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 min-w-0 flex flex-col">
          <CashflowSparkline
            transactions={transactions}
            onSimulate={() =>
              onQuickAction ? onQuickAction('simulate-tx') : onNavigate('transactions')
            }
          />
        </div>

        <div className="lg:col-span-5 cm-panel divide-y divide-black/[0.06] flex flex-col justify-between min-w-0 overflow-hidden">
          <div className="px-5 py-3.5 bg-[#FAFAFA] flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#09090B]">
              Thành phần hệ thống
            </span>
            <Badge tone={allReady ? 'green' : 'amber'}>
              {allReady ? 'Hoạt động ổn định' : `${completedCount}/${steps.length} bước`}
            </Badge>
          </div>
          {[
            {
              title: 'Tài khoản nhận tiền',
              desc: `${verifiedBanks}/${accounts.length} tài khoản bật Strict DKIM`,
              tab: 'accounts',
              icon: Bank,
              accessory: (
                <div className="hidden sm:flex items-center -space-x-1 shrink-0">
                  <BankLogo code={uniqueConnectedBanks[0]?.bankCode ?? 'CAKE'} size="xs" />
                  <BankLogo code={uniqueConnectedBanks[1]?.bankCode ?? 'VCB'} size="xs" />
                </div>
              ),
            },
            {
              title: 'Định tuyến đa kênh',
              desc: `${rules.filter((r) => r.enabled).length} kênh đang kích hoạt`,
              tab: 'routing',
              icon: ShareNetwork,
              accessory: (
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  <BrandIcon id="telegram" size={14} tile label="Telegram" />
                  <BrandIcon id="discord" size={14} tile label="Discord" />
                  <BrandIcon id="google-sheets" size={14} tile label="Google Sheets" />
                </div>
              ),
            },
            {
              title: 'Loa thông báo & POS Mini',
              desc: 'Phát âm thanh và tạo VietQR thu ngân tức thì',
              tab: 'soundboxes',
              icon: SpeakerHigh,
              accessory: (
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  <BrandIcon id="arduino" size={14} tile label="ESP32" />
                </div>
              ),
            },
            {
              title: 'Hộp cách ly 72 giờ',
              desc:
                quarantine.length > 0
                  ? `${quarantine.length} email cần rà soát`
                  : 'Không có thư bất thường',
              tab: 'quarantine',
              icon: ShieldWarning,
              accessory: null,
            },
          ].map((row) => {
            const RowIcon = row.icon;
            return (
              <button
                key={row.title}
                type="button"
                onClick={() => onNavigate(row.tab)}
                className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#FAFAFA] transition-colors duration-150 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="cm-kpi-badge">
                    <RowIcon size={15} weight="duotone" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#09090B] truncate">{row.title}</div>
                    <div className="text-[12px] text-[#71717A] truncate">{row.desc}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {row.accessory}
                  <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Setup Checklist */}
      <div className="cm-panel overflow-hidden">
        <button
          type="button"
          onClick={() => setChecklistOpen((v) => !v)}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-[#FAFAFA] transition-colors duration-150 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[13.5px] font-semibold text-[#09090B]">
              Danh sách thiết lập ban đầu
            </span>
            <Badge tone={allReady ? 'green' : 'slate'}>
              {completedCount}/{steps.length} hoàn tất
            </Badge>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#71717A] transition-transform duration-200 ${
              checklistOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {checklistOpen && (
          <div className="border-t border-black/[0.06] grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-black/[0.06]">
            {steps.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={s.action}
                className="flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[#FAFAFA] transition-colors duration-150 cursor-pointer border-b border-black/[0.06] last:border-b-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {s.done ? (
                    <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-300 shrink-0" />
                  )}
                  <span
                    className={`text-[13px] truncate ${
                      s.done ? 'text-[#71717A] line-through' : 'font-medium text-[#09090B]'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2-Column Live Activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="cm-panel overflow-hidden min-w-0">
          <div className="px-5 py-3.5 border-b border-black/[0.06] flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-[#09090B]">Giao dịch gần nhất</h3>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] cursor-pointer"
            >
              Xem sổ giao dịch
            </button>
          </div>
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[#71717A]">
              Chưa có giao dịch nào được ghi nhận.
            </div>
          ) : (
            <div className="divide-y divide-black/[0.06]">
              {transactions.slice(0, 5).map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => onNavigate('transactions')}
                  className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#FAFAFA] transition-colors duration-150 cursor-pointer min-w-0"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <IdentityAvatar seed={tx.content || tx.bankTxId} size="xs" />
                    <BankEmblem code={tx.bankCode} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono-num text-[12.5px] font-medium text-[#09090B] truncate">
                          {tx.content || tx.bankTxId}
                        </span>
                        {tx.isTest && <Badge tone="blue">Sandbox</Badge>}
                      </div>
                      <div className="text-[11.5px] text-[#71717A] mt-0.5 truncate font-mono-num">
                        {tx.bankTxId}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="font-mono-num text-[13px] font-semibold text-[#047857] whitespace-nowrap">
                      +{formatVnd(tx.amount)}
                    </div>
                    <div className="text-[11px] text-[#71717A]">
                      {formatDateTime(tx.occurredAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cm-panel overflow-hidden min-w-0">
          <div className="px-5 py-3.5 border-b border-black/[0.06] flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-[#09090B] flex items-center gap-2">
              <Webhook className="w-3.5 h-3.5 text-[#52525B]" />
              Chuyển tiếp gần đây
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('routing')}
              className="text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] cursor-pointer"
            >
              Xem nhật ký
            </button>
          </div>
          {deliveries.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[#71717A]">
              Chưa có sự kiện nào được chuyển tiếp.
            </div>
          ) : (
            <div className="divide-y divide-black/[0.06]">
              {deliveries.slice(0, 5).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onNavigate('routing')}
                  className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#FAFAFA] transition-colors duration-150 cursor-pointer min-w-0"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <ChannelBadgeIcon format={d.payloadFormat ?? 'comey'} size={15} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-mono-num font-medium text-[#09090B] truncate">
                        {d.eventType}
                      </div>
                      <div className="text-[11.5px] text-[#71717A] mt-0.5 truncate font-mono-num">
                        {d.targetUrl}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                    <div className="text-[11px] text-[#71717A] font-mono-num">
                      HTTP {d.lastHttpStatus ?? '—'} ({d.attemptCount})
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
