import {
  ArrowsClockwise,
  Key,
  PlayCircle,
  PlusCircle,
  QrCode as PhQrCode,
  RocketLaunch,
  ShareNetwork,
  SpeakerHigh,
} from '@phosphor-icons/react';
import { Command } from 'cmdk';
import {
  Activity,
  ArrowRight,
  Landmark,
  LayoutDashboard,
  Lock,
  QrCode,
  Rocket,
  Search,
  ShieldAlert,
  Volume2,
  Webhook,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatVnd } from '../lib/format';
import type { BankAccount, PaymentSessionItem, TransactionItem } from '../lib/types';
import { BankEmblem } from './BankEmblem';
import { IdentityAvatar } from './IdentityAvatar';

export type QuickActionId =
  | 'new-account'
  | 'new-rule'
  | 'simulate-tx'
  | 'dynamic-qr'
  | 'new-soundbox'
  | 'new-apikey'
  | 'deploy-guide'
  | 'refresh';

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onQuickAction,
  accounts,
  transactions,
  sessions,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onQuickAction: (action: QuickActionId) => void;
  accounts: BankAccount[];
  transactions: TransactionItem[];
  sessions: PaymentSessionItem[];
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  function trigger(fn: () => void) {
    onClose();
    fn();
  }

  const quickActions: Array<{
    id: string;
    label: string;
    hint: string;
    keywords: string[];
    icon: React.ComponentType<{ size?: number; weight?: 'duotone' | 'regular'; className?: string }>;
    action: QuickActionId;
  }> = [
    {
      id: 'act-acc',
      label: 'Thêm tài khoản ngân hàng',
      hint: 'Cake, MB, VCB, Techcombank, Timo, ACB',
      keywords: ['bank', 'tai khoan', 'ngan hang', 'cake', 'mb', 'vcb'],
      icon: PlusCircle,
      action: 'new-account',
    },
    {
      id: 'act-rule',
      label: 'Tạo kênh nhận Webhook hoặc Telegram / Discord / Sheets',
      hint: 'Định tuyến sự kiện',
      keywords: ['webhook', 'telegram', 'discord', 'sheets', 'sepay', 'payos'],
      icon: ShareNetwork,
      action: 'new-rule',
    },
    {
      id: 'act-sim',
      label: 'Mô phỏng giao dịch chuyển khoản',
      hint: 'Kiểm thử toàn trình pipeline',
      keywords: ['simulate', 'mo phong', 'test', 'giao dich'],
      icon: PlayCircle,
      action: 'simulate-tx',
    },
    {
      id: 'act-qr',
      label: 'Tạo link ảnh VietQR động',
      hint: 'GET /qr PNG & SVG',
      keywords: ['vietqr', 'qr', 'anh qr'],
      icon: PhQrCode,
      action: 'dynamic-qr',
    },
    {
      id: 'act-sbx',
      label: 'Tạo loa thu ngân mới',
      hint: 'Kèm POS Mini 2-in-1',
      keywords: ['soundbox', 'loa', 'pos', 'esp32'],
      icon: SpeakerHigh,
      action: 'new-soundbox',
    },
    {
      id: 'act-deploy',
      label: 'Triển khai lên Cloudflare Workers & D1',
      hint: 'CLI Deploy, wrangler.jsonc & /health',
      keywords: ['deploy', 'trien khai', 'cloudflare', 'wrangler', 'd1'],
      icon: RocketLaunch,
      action: 'deploy-guide',
    },
    {
      id: 'act-key',
      label: 'Tạo API Key phân quyền RBAC',
      hint: 'Triển khai & API',
      keywords: ['api', 'key', 'rbac', 'openapi'],
      icon: Key,
      action: 'new-apikey',
    },
    {
      id: 'act-ref',
      label: 'Đồng bộ lại dữ liệu Workspace',
      hint: 'Tải lại toàn bộ bảng',
      keywords: ['refresh', 'lam moi', 'dong bo'],
      icon: ArrowsClockwise,
      action: 'refresh',
    },
  ];

  const navItems: Array<{
    id: string;
    label: string;
    tab: string;
    keywords: string[];
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'nav-overview', label: 'Tổng quan', tab: 'overview', keywords: ['overview', 'tong quan'], icon: LayoutDashboard },
    { id: 'nav-tx', label: 'Sổ giao dịch', tab: 'transactions', keywords: ['transactions', 'so giao dich'], icon: Activity },
    { id: 'nav-sessions', label: 'Thanh toán & VietQR', tab: 'sessions', keywords: ['checkout', 'vietqr', 'phien'], icon: QrCode },
    { id: 'nav-accounts', label: 'Tài khoản ngân hàng', tab: 'accounts', keywords: ['accounts', 'ngan hang'], icon: Landmark },
    { id: 'nav-routing', label: 'Định tuyến sự kiện', tab: 'routing', keywords: ['routing', 'webhook', 'telegram'], icon: Webhook },
    { id: 'nav-sbx', label: 'Loa thu ngân', tab: 'soundboxes', keywords: ['soundbox', 'loa'], icon: Volume2 },
    { id: 'nav-quar', label: 'Hộp cách ly', tab: 'quarantine', keywords: ['quarantine', 'cach ly', 'dkim'], icon: ShieldAlert },
    { id: 'nav-sec', label: 'Bảo mật', tab: 'security', keywords: ['security', 'bao mat', 'audit'], icon: Lock },
    { id: 'nav-dev', label: 'Triển khai & API', tab: 'developers', keywords: ['deploy', 'trien khai', 'cloudflare', 'api', 'sdk', 'openapi'], icon: Rocket },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/25 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Tìm nhanh và thao tác"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[12px] bg-white shadow-2xl border border-black/[0.1] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <Command label="Tìm nhanh và thao tác" shouldFilter>
          <div className="flex items-center gap-2.5 px-4 h-12 border-b border-black/[0.08]">
            <Search className="w-4 h-4 text-[#71717A] shrink-0" />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Tìm thao tác, màn hình, số tài khoản, mã đơn..."
              className="flex-1 bg-transparent text-[13.5px] text-[#09090B] placeholder:text-[#A1A1AA] focus:outline-none"
            />
            <kbd className="text-[11px] font-mono-num text-[#71717A] bg-[#F4F4F5] px-1.5 py-0.5 rounded-[4px] border border-black/[0.08]">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
            <Command.Empty className="py-10 text-center text-[13px] text-[#71717A]">
              Không tìm thấy kết quả phù hợp.
            </Command.Empty>

            <Command.Group heading="Thao tác nhanh">
              {quickActions.map((row) => {
                const Icon = row.icon;
                return (
                  <Command.Item
                    key={row.id}
                    value={`${row.label} ${row.hint} ${row.keywords.join(' ')}`}
                    onSelect={() => trigger(() => onQuickAction(row.action))}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-[6px] bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center shrink-0">
                        <Icon size={14} weight="duotone" className="text-[#047857]" />
                      </span>
                      <span className="text-[13px] font-medium truncate text-[#09090B]">
                        {row.label}
                      </span>
                      <span className="text-[12px] text-[#71717A] truncate hidden sm:inline">
                        {row.hint}
                      </span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading="Điều hướng">
              {navItems.map((row) => {
                const Icon = row.icon;
                return (
                  <Command.Item
                    key={row.id}
                    value={`${row.label} ${row.keywords.join(' ')}`}
                    onSelect={() => trigger(() => onNavigate(row.tab))}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 text-[#52525B] shrink-0" />
                      <span className="text-[13px] font-medium truncate text-[#09090B]">
                        {row.label}
                      </span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                  </Command.Item>
                );
              })}
            </Command.Group>

            {accounts.length > 0 && (
              <Command.Group heading="Tài khoản ngân hàng">
                {accounts.map((a) => (
                  <Command.Item
                    key={`acc-${a.id}`}
                    value={`${a.bankCode} ${a.accountNumber} ${a.accountName} ${a.inboundEmail}`}
                    onSelect={() => trigger(() => onNavigate('accounts'))}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <BankEmblem code={a.bankCode} size="sm" />
                      <span className="font-mono-num text-[13px] font-medium text-[#09090B] truncate">
                        {a.accountNumber}
                      </span>
                      <span className="text-[12px] text-[#71717A] truncate hidden sm:inline">
                        {a.accountName}
                      </span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {transactions.length > 0 && (
              <Command.Group heading="Giao dịch gần đây">
                {transactions.slice(0, 12).map((tx) => (
                  <Command.Item
                    key={`tx-${tx.id}`}
                    value={`${tx.content} ${tx.bankTxId} ${tx.bankCode} ${tx.amount}`}
                    onSelect={() => trigger(() => onNavigate('transactions'))}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <IdentityAvatar seed={tx.content || tx.bankTxId} size="xs" />
                      <span className="font-mono-num text-[12.5px] font-semibold text-[#047857] shrink-0">
                        +{formatVnd(tx.amount)}
                      </span>
                      <span className="font-mono-num text-[12.5px] text-[#09090B] truncate">
                        {tx.content || tx.bankTxId}
                      </span>
                    </span>
                    <BankEmblem code={tx.bankCode} size="sm" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {sessions.length > 0 && (
              <Command.Group heading="Phiên thanh toán">
                {sessions.slice(0, 10).map((s) => (
                  <Command.Item
                    key={`sess-${s.id}`}
                    value={`${s.orderCode} ${s.shortId} ${s.bankCode} ${s.expectedAmount}`}
                    onSelect={() => trigger(() => onNavigate('sessions'))}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <QrCode className="w-4 h-4 text-[#047857] shrink-0" />
                      <span className="font-mono-num text-[13px] font-medium text-[#09090B]">
                        {s.orderCode}
                      </span>
                      <span className="font-mono-num text-[12px] text-[#71717A]">
                        {formatVnd(s.expectedAmount)}
                      </span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
