import { ShareNetwork } from '@phosphor-icons/react';
import { Eye, FlaskConical, KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { ChannelBadgeIcon } from '../components/BrandIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { SheetDrawer } from '../components/SheetDrawer';
import { Tip } from '../components/Tooltip';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  SANDBOX_WEBHOOK_URL,
  TELEGRAM_URL_PREFIX,
  type BankAccount,
  type RoutingRule,
  type WebhookDeliveryDetail,
  type WebhookDeliveryItem,
  type WebhookPayloadFormat,
} from '../lib/types';

function formatLabel(format: WebhookPayloadFormat): {
  label: string;
  tone: 'slate' | 'green' | 'amber' | 'blue' | 'lime';
} {
  if (format === 'sepay') return { label: 'SePay Drop-in', tone: 'green' };
  if (format === 'payos') return { label: 'PayOS Drop-in', tone: 'amber' };
  if (format === 'telegram') return { label: 'Telegram Bot', tone: 'blue' };
  if (format === 'discord') return { label: 'Discord', tone: 'slate' };
  if (format === 'google_sheets') return { label: 'Google Sheets', tone: 'green' };
  return { label: 'Comey HMAC', tone: 'lime' };
}

function prettyPayloadJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const CHANNEL_CHOICES: Array<{
  id: WebhookPayloadFormat;
  title: string;
  desc: string;
}> = [
  { id: 'comey', title: 'Comey HMAC', desc: 'Chữ ký X-Comey-Signature' },
  { id: 'sepay', title: 'SePay Drop-in', desc: 'Header Authorization Apikey' },
  { id: 'payos', title: 'PayOS Drop-in', desc: 'Ký JSON Checksum Key' },
  { id: 'telegram', title: 'Telegram Bot', desc: 'Không cần thuê máy chủ' },
  { id: 'discord', title: 'Discord Webhook', desc: 'Thẻ Embed tức thì' },
  { id: 'google_sheets', title: 'Google Sheets', desc: 'Tự động ghi sổ thu chi' },
];

const SHEETS_SCRIPT = `function doPost(e) {\n  var d = JSON.parse(e.postData.contents);\n  SpreadsheetApp.getActiveSheet().appendRow([\n    d.date, d.bankCode, d.accountNumber, d.amount, d.content, d.senderName || '', d.txId\n  ]);\n  return ContentService.createTextOutput('ok');\n}`;

export function RoutingWebhooksPage({
  accounts,
  rules,
  deliveries,
  onReload,
  onNotify,
  openCreateSignal = 0,
  preselectedFormat,
}: {
  accounts: BankAccount[];
  rules: RoutingRule[];
  deliveries: WebhookDeliveryItem[];
  onReload: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  openCreateSignal?: number;
  preselectedFormat?: WebhookPayloadFormat;
}) {
  const [viewTab, setViewTab] = useState<'rules' | 'deliveries'>('rules');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id || '');
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'prefix' | 'regex' | 'all'>('prefix');
  const [pattern, setPattern] = useState('SHOP');
  const [priority, setPriority] = useState(10);
  const [payloadFormat, setPayloadFormat] = useState<WebhookPayloadFormat>(
    preselectedFormat || 'comey'
  );
  const [useSandbox, setUseSandbox] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdSecret, setCreatedSecret] = useState('');
  const [createdFormat, setCreatedFormat] = useState<WebhookPayloadFormat>('comey');

  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'delivered' | 'retrying' | 'failed'>(
    'all'
  );
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [inspectDetail, setInspectDetail] = useState<WebhookDeliveryDetail | null>(null);
  const [loadingInspectId, setLoadingInspectId] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<RoutingRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null);

  useEffect(() => {
    if (openCreateSignal > 0) {
      if (preselectedFormat) {
        setPayloadFormat(preselectedFormat);
      }
      setDrawerOpen(true);
    }
  }, [openCreateSignal, preselectedFormat]);

  function openChannelDrawer(fmt?: WebhookPayloadFormat) {
    setFormError('');
    if (fmt) setPayloadFormat(fmt);
    setDrawerOpen(true);
  }

  const selectedAccountId = bankAccountId || accounts[0]?.id || '';

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!selectedAccountId) {
      setFormError('Vui lòng thêm ít nhất một tài khoản ngân hàng trước');
      return;
    }
    setCreating(true);
    try {
      const isTelegramLive = payloadFormat === 'telegram' && !useSandbox;
      const res = await api.routingRules.create({
        bankAccountId: selectedAccountId,
        name: name.trim() || `${payloadFormat.toUpperCase()} ${pattern || 'ALL'}`,
        matchType,
        pattern: matchType === 'all' ? undefined : pattern,
        priority,
        payloadFormat,
        webhookUrl: useSandbox ? SANDBOX_WEBHOOK_URL : isTelegramLive ? undefined : webhookUrl,
        telegramBotToken: isTelegramLive ? telegramBotToken.trim() : undefined,
        telegramChatId: isTelegramLive ? telegramChatId.trim() : undefined,
      });
      setCreatedSecret(res.webhookSecret);
      setCreatedFormat(res.routingRule.payloadFormat);
      setName('');
      if (!useSandbox) {
        setWebhookUrl('');
        setTelegramBotToken('');
        setTelegramChatId('');
      }
      setDrawerOpen(false);
      await onReload();
      onNotify('success', 'Đã tạo kênh định tuyến mới');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Không thể tạo kênh nhận';
      setFormError(msg);
      onNotify('error', msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleRule(rule: RoutingRule) {
    try {
      await api.routingRules.update(rule.id, { enabled: !rule.enabled });
      await onReload();
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể cập nhật trạng thái');
    }
  }

  async function handleRotateConfirmed() {
    if (!rotateTarget) return;
    try {
      const res = await api.routingRules.rotateSecret(rotateTarget.id);
      setCreatedSecret(res.webhookSecret);
      setCreatedFormat(rotateTarget.payloadFormat);
      onNotify('success', `Đã xoay vòng Secret cho kênh "${rotateTarget.name}"`);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi xoay vòng Secret');
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    try {
      await api.routingRules.remove(deleteTarget.id);
      await onReload();
      onNotify('success', 'Đã xóa kênh định tuyến');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi xóa kênh');
    }
  }

  async function handleReplay(id: string) {
    setReplayingId(id);
    try {
      await api.deliveries.replay(id);
      await onReload();
      onNotify('success', 'Đã gửi lại sự kiện');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi gửi lại sự kiện');
    } finally {
      setReplayingId(null);
    }
  }

  async function handleInspect(id: string) {
    setLoadingInspectId(id);
    try {
      const res = await api.deliveries.get(id);
      setInspectDetail(res.delivery);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể đọc payload');
    } finally {
      setLoadingInspectId(null);
    }
  }

  const filteredDeliveries =
    deliveryFilter === 'all'
      ? deliveries
      : deliveries.filter((d) => d.status === deliveryFilter);

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Định tuyến sự kiện
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5">
            Chuyển tiếp biến động số dư tới Webhook, SePay, PayOS, Telegram Bot, Discord và Google
            Sheets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setDrawerOpen(true);
          }}
          className="cm-btn cm-btn-primary"
        >
          <Plus className="w-4 h-4" /> Tạo kênh nhận
        </button>
      </div>

      {createdSecret && (
        <div className="cm-panel border-[#A7F3D0] bg-[#ECFDF5]/60 p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="text-[12.5px] text-[#047857] min-w-0 flex-1 space-y-0.5">
            <div className="font-semibold">
              {createdFormat === 'sepay'
                ? 'SePay API Key (gửi qua header Authorization Apikey — chỉ hiển thị một lần)'
                : createdFormat === 'payos'
                  ? 'PayOS Checksum Key (ký trường signature trong JSON — chỉ hiển thị một lần)'
                  : 'Webhook Signing Secret (xác thực header X-Comey-Signature — chỉ hiển thị một lần)'}
            </div>
            <code className="block font-mono-num text-[13px] font-semibold text-[#09090B] break-all">
              {createdSecret}
            </code>
          </div>
          <CopyButton
            value={createdSecret}
            label="Sao chép Secret"
            variant="dark"
            onCopied={(ok) =>
              onNotify(
                ok ? 'success' : 'error',
                ok ? 'Đã sao chép Secret' : 'Không thể sao chép'
              )
            }
          />
        </div>
      )}

      {/* 1-Click Channel Template Deck */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {CHANNEL_CHOICES.map((ch) => {
          const activeCount = rules.filter((r) => r.payloadFormat === ch.id && r.enabled).length;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => openChannelDrawer(ch.id)}
              className="cm-panel cm-card-interactive p-3.5 text-left flex flex-col justify-between gap-2.5 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <ChannelBadgeIcon format={ch.id} size={18} />
                {activeCount > 0 && (
                  <span className="font-mono-num text-[10.5px] font-semibold text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-1.5 py-0.5 rounded-[5px]">
                    {activeCount}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-[#09090B] truncate">
                  {ch.title}
                </div>
                <div className="text-[11px] text-[#71717A] truncate mt-0.5">{ch.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={viewTab}
          onChange={setViewTab}
          ariaLabel="Chế độ xem định tuyến"
          options={[
            { value: 'rules', label: 'Kênh định tuyến', count: rules.length },
            { value: 'deliveries', label: 'Nhật ký gửi', count: deliveries.length },
          ]}
        />

        {viewTab === 'deliveries' && (
          <SegmentedControl
            size="sm"
            value={deliveryFilter}
            onChange={setDeliveryFilter}
            ariaLabel="Lọc trạng thái gửi"
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'delivered', label: 'Thành công' },
              { value: 'retrying', label: 'Chờ thử lại' },
              { value: 'failed', label: 'Thất bại' },
            ]}
          />
        )}
      </div>

      {viewTab === 'rules' ? (
        <div className="cm-panel overflow-hidden min-w-0">
          {rules.length === 0 ? (
            <EmptyState
              icon={ShareNetwork}
              title="Chưa có kênh định tuyến nào"
              description="Tạo kênh nhận để tự động gửi thông báo qua Telegram, Discord, Google Sheets hoặc bắn webhook khi tiền vào."
              action={
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="cm-btn cm-btn-primary"
                >
                  <Plus className="w-4 h-4" /> Tạo kênh đầu tiên
                </button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                  <tr>
                    <th className="px-4 py-2.5">Ưu tiên</th>
                    <th className="px-4 py-2.5">Tên kênh</th>
                    <th className="px-4 py-2.5">Định dạng</th>
                    <th className="px-4 py-2.5">Điều kiện khớp</th>
                    <th className="px-4 py-2.5">Đích nhận</th>
                    <th className="px-4 py-2.5">Trạng thái</th>
                    <th className="px-4 py-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {rules.map((r) => {
                    const fmt = formatLabel(r.payloadFormat ?? 'comey');
                    return (
                      <tr key={r.id} className="hover:bg-[#FAFAFA] transition-colors duration-100">
                        <td className="px-4 py-3 font-mono-num font-medium text-[#52525B]">
                          {r.priority}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#09090B]">{r.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ChannelBadgeIcon format={r.payloadFormat ?? 'comey'} size={15} />
                            <Badge tone={fmt.tone}>{fmt.label}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num">
                          <div className="flex items-center gap-1.5">
                            <Badge tone="slate">{r.matchType}</Badge>
                            <span className="font-medium text-[#09090B]">{r.pattern || '*'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num text-[12.5px] max-w-xs truncate">
                          {r.webhookUrl === SANDBOX_WEBHOOK_URL ? (
                            <span className="inline-flex items-center gap-1.5 text-[#047857] font-medium">
                              <FlaskConical className="w-3.5 h-3.5 shrink-0" /> Môi trường Sandbox
                            </span>
                          ) : r.webhookUrl.startsWith(TELEGRAM_URL_PREFIX) ? (
                            <span className="text-sky-700 font-medium">
                              Telegram Chat {r.webhookUrl.slice(TELEGRAM_URL_PREFIX.length)}
                            </span>
                          ) : (
                            <span className="text-[#52525B]">{r.webhookUrl}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void handleToggleRule(r)}
                            className="cursor-pointer"
                          >
                            <Badge tone={r.enabled ? 'green' : 'slate'}>
                              {r.enabled ? 'Đang bật' : 'Tạm tắt'}
                            </Badge>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {r.payloadFormat !== 'telegram' && r.payloadFormat !== 'discord' && (
                              <Tip label="Xoay vòng Webhook Secret">
                                <button
                                  type="button"
                                  onClick={() => setRotateTarget(r)}
                                  className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                                >
                                  <KeyRound className="w-3.5 h-3.5" /> Xoay Secret
                                </button>
                              </Tip>
                            )}
                            <Tip label="Xóa kênh nhận">
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(r)}
                                className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-[6px] text-[#71717A] hover:text-[#DC2626] hover:bg-rose-50 cursor-pointer transition-colors duration-150"
                                aria-label={`Xóa kênh ${r.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </Tip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="cm-panel overflow-hidden min-w-0">
          {filteredDeliveries.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-[#71717A]">
              Chưa có log chuyển tiếp nào trong bộ lọc hiện tại.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                  <tr>
                    <th className="px-4 py-2.5">Sự kiện</th>
                    <th className="px-4 py-2.5">Đích nhận</th>
                    <th className="px-4 py-2.5">Trạng thái</th>
                    <th className="px-4 py-2.5">Phản hồi</th>
                    <th className="px-4 py-2.5">Cập nhật</th>
                    <th className="px-4 py-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {filteredDeliveries.map((d) => {
                    const fmt = formatLabel(d.payloadFormat ?? 'comey');
                    return (
                      <tr key={d.id} className="hover:bg-[#FAFAFA] transition-colors duration-100">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <ChannelBadgeIcon format={d.payloadFormat ?? 'comey'} size={15} />
                            <div className="space-y-1">
                              <div className="font-mono-num font-medium text-[#09090B]">
                                {d.eventType}
                              </div>
                              <Badge tone={fmt.tone}>{fmt.label}</Badge>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num text-[12.5px] max-w-xs truncate">
                          {d.targetUrl === SANDBOX_WEBHOOK_URL ? (
                            <span className="inline-flex items-center gap-1.5 text-[#047857] font-medium">
                              <FlaskConical className="w-3.5 h-3.5 shrink-0" /> Sandbox Inbox
                            </span>
                          ) : (
                            <span className="text-[#52525B]">{d.targetUrl}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                          {d.lastError && (
                            <div className="text-[11.5px] text-[#DC2626] mt-0.5 max-w-[200px] truncate">
                              {d.lastError}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-num text-[12.5px] text-[#52525B]">
                          HTTP {d.lastHttpStatus ?? '—'} ({d.attemptCount}/{d.maxAttempts})
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-[#71717A] whitespace-nowrap">
                          {formatDateTime(d.updatedAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={loadingInspectId === d.id}
                              onClick={() => void handleInspect(d.id)}
                              className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                            >
                              <Eye className="w-3.5 h-3.5" /> Kiểm tra
                            </button>
                            <button
                              type="button"
                              disabled={replayingId === d.id}
                              onClick={() => void handleReplay(d.id)}
                              className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                            >
                              <RotateCw
                                className={`w-3.5 h-3.5 ${
                                  replayingId === d.id ? 'animate-spin' : ''
                                }`}
                              />
                              Gửi lại
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Routing Channel Drawer */}
      <SheetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title="Tạo kênh nhận mới"
        subtitle="Chọn định dạng đầu ra và quy tắc khớp nội dung chuyển khoản."
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="cm-btn cm-btn-secondary"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              form="rr-create-form"
              disabled={creating || accounts.length === 0}
              className="cm-btn cm-btn-primary"
            >
              {creating ? 'Đang lưu...' : 'Lưu kênh định tuyến'}
            </button>
          </div>
        }
      >
        <form id="rr-create-form" onSubmit={handleCreateRule} className="space-y-5">
          <div className="space-y-2">
            <div className="text-[12.5px] font-medium text-[#09090B]">
              Chọn kênh và định dạng dữ liệu
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CHANNEL_CHOICES.map((ch) => {
                const active = payloadFormat === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setPayloadFormat(ch.id)}
                    className={`rounded-[8px] border p-2.5 text-left cursor-pointer ${
                      active
                        ? 'border-[#09090B] bg-[#09090B] text-white'
                        : 'border-black/[0.08] bg-white hover:bg-[#FAFAFA] text-[#09090B]'
                    }`}
                  >
                    <div className="mb-2">
                      <ChannelBadgeIcon format={ch.id} size={18} onDark={active} />
                    </div>
                    <div
                      className={`text-[12.5px] font-semibold leading-tight ${
                        active ? 'text-white' : 'text-[#09090B]'
                      }`}
                    >
                      {ch.title}
                    </div>
                    <div
                      className={`text-[11px] mt-0.5 leading-snug ${
                        active ? 'text-zinc-300' : 'text-[#71717A]'
                      }`}
                    >
                      {ch.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rr-bank-account" className="block text-[12.5px] font-medium mb-1.5">
                Tài khoản nguồn
              </label>
              <select
                id="rr-bank-account"
                value={selectedAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="cm-input"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankCode} ({a.accountNumber})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rr-name" className="block text-[12.5px] font-medium mb-1.5">
                Tên gợi nhớ
              </label>
              <input
                id="rr-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nhóm kế toán / Webhook shop"
                className="cm-input"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="rr-match-type" className="block text-[12.5px] font-medium mb-1.5">
                Kiểu khớp nội dung
              </label>
              <select
                id="rr-match-type"
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as 'prefix' | 'regex' | 'all')}
                className="cm-input"
              >
                <option value="prefix">Tiền tố (Prefix)</option>
                <option value="regex">Regex an toàn</option>
                <option value="all">Tất cả giao dịch</option>
              </select>
            </div>
            <div>
              <label htmlFor="rr-pattern" className="block text-[12.5px] font-medium mb-1.5">
                Mẫu khớp (Pattern)
              </label>
              <input
                id="rr-pattern"
                type="text"
                disabled={matchType === 'all'}
                value={matchType === 'all' ? '*' : pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="SHOP"
                className="cm-input font-mono-num"
              />
            </div>
            <div>
              <label htmlFor="rr-priority" className="block text-[12.5px] font-medium mb-1.5">
                Thứ tự ưu tiên
              </label>
              <input
                id="rr-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="cm-input font-mono-num"
              />
            </div>
          </div>

          <label
            htmlFor="routing-use-sandbox"
            className="flex items-start gap-2.5 rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] p-3.5 text-[12.5px] text-[#52525B] cursor-pointer leading-relaxed"
          >
            <input
              id="routing-use-sandbox"
              type="checkbox"
              checked={useSandbox}
              onChange={(e) => setUseSandbox(e.target.checked)}
              className="h-4 w-4 shrink-0 mt-0.5 rounded accent-[#047857]"
            />
            <span>
              <span className="font-semibold text-[#09090B] block">
                Gửi vào Môi trường Sandbox nội bộ
              </span>
              Ghi nhận payload trực tiếp để kiểm tra cấu trúc JSON mà không cần URL máy chủ bên
              ngoài.
            </span>
          </label>

          {payloadFormat === 'telegram' && !useSandbox ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="rr-tg-token" className="block text-[12.5px] font-medium mb-1.5">
                  Telegram Bot Token (mã hóa AES-GCM)
                </label>
                <input
                  id="rr-tg-token"
                  type="password"
                  required
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="123456789:AAH..."
                  className="cm-input font-mono-num"
                />
              </div>
              <div>
                <label htmlFor="rr-tg-chat" className="block text-[12.5px] font-medium mb-1.5">
                  Chat ID hoặc Group ID
                </label>
                <input
                  id="rr-tg-chat"
                  type="text"
                  required
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="-1001234567890"
                  className="cm-input font-mono-num"
                />
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="rr-webhook-url" className="block text-[12.5px] font-medium mb-1.5">
                {payloadFormat === 'google_sheets'
                  ? 'URL Google Apps Script Web App (/exec)'
                  : payloadFormat === 'discord'
                    ? 'Discord Webhook URL'
                    : 'Webhook URL đích'}
              </label>
              <input
                id="rr-webhook-url"
                type={useSandbox ? 'text' : 'url'}
                required
                disabled={useSandbox}
                value={useSandbox ? SANDBOX_WEBHOOK_URL : webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={
                  payloadFormat === 'discord'
                    ? 'https://discord.com/api/webhooks/...'
                    : payloadFormat === 'google_sheets'
                      ? 'https://script.google.com/macros/s/.../exec'
                      : 'https://your-backend.com/webhooks/comey'
                }
                className="cm-input font-mono-num"
              />
            </div>
          )}

          {payloadFormat === 'google_sheets' && !useSandbox && (
            <div className="rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[#09090B]">
                  Mã Apps Script ghi dòng vào Google Sheets
                </span>
                <CopyButton
                  value={SHEETS_SCRIPT}
                  label="Sao chép mã"
                  size="xs"
                  onCopied={(ok) =>
                    onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép mã Script' : 'Lỗi sao chép')
                  }
                />
              </div>
              <pre className="overflow-x-auto font-mono-num text-[11px] bg-white border border-black/[0.08] rounded-[6px] p-2.5 text-[#09090B]">
                {SHEETS_SCRIPT}
              </pre>
            </div>
          )}

          {formError && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
              {formError}
            </div>
          )}
        </form>
      </SheetDrawer>

      {/* Slide-Over Payload Inspector */}
      <SheetDrawer
        open={Boolean(inspectDetail)}
        onClose={() => setInspectDetail(null)}
        size="lg"
        title="Chi tiết sự kiện chuyển tiếp"
        subtitle={inspectDetail ? `${inspectDetail.eventId} (${inspectDetail.eventType})` : ''}
        footer={
          inspectDetail && (
            <div className="flex items-center justify-between gap-2">
              <CopyButton
                value={prettyPayloadJson(inspectDetail.payloadJson)}
                label="Sao chép JSON"
                onCopied={(ok) =>
                  onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép JSON' : 'Không thể sao chép')
                }
              />
              <button
                type="button"
                disabled={replayingId === inspectDetail.id}
                onClick={() => void handleReplay(inspectDetail.id)}
                className="cm-btn cm-btn-primary"
              >
                <RotateCw
                  className={`w-3.5 h-3.5 ${replayingId === inspectDetail.id ? 'animate-spin' : ''}`}
                />
                Gửi lại sự kiện
              </button>
            </div>
          )
        }
      >
        {inspectDetail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={formatLabel(inspectDetail.payloadFormat ?? 'comey').tone}>
                {formatLabel(inspectDetail.payloadFormat ?? 'comey').label}
              </Badge>
              <Badge tone={statusTone(inspectDetail.status)}>{inspectDetail.status}</Badge>
              {inspectDetail.lastHttpStatus && (
                <Badge tone="slate">HTTP {inspectDetail.lastHttpStatus}</Badge>
              )}
            </div>

            <div className="rounded-[8px] bg-[#FAFAFA] border border-black/[0.08] px-3.5 py-2.5 text-[12px] text-[#52525B] leading-relaxed">
              {inspectDetail.payloadFormat === 'sepay' && (
                <span>
                  Xác thực qua header <code className="font-mono-num font-semibold">Authorization: Apikey</code>.
                </span>
              )}
              {inspectDetail.payloadFormat === 'payos' && (
                <span>
                  Chữ ký <code className="font-mono-num font-semibold">signature</code> được tạo từ
                  HMAC-SHA256 các khóa sắp xếp theo bảng chữ cái.
                </span>
              )}
              {inspectDetail.payloadFormat === 'telegram' && (
                <span>
                  Gửi trực tiếp tới Telegram Bot API /sendMessage bằng Bot Token được mã hóa AES-GCM.
                </span>
              )}
              {inspectDetail.payloadFormat === 'discord' && (
                <span>Gửi thẻ Embed trực tiếp tới Discord Webhook URL.</span>
              )}
              {inspectDetail.payloadFormat === 'google_sheets' && (
                <span>
                  Gửi JSON phẳng tới Google Apps Script Web App kèm bước theo dõi chuyển hướng
                  script.googleusercontent.com.
                </span>
              )}
              {(inspectDetail.payloadFormat ?? 'comey') === 'comey' && (
                <span>
                  Xác thực toàn vẹn qua header{' '}
                  <code className="font-mono-num font-semibold">X-Comey-Signature</code>.
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-[#71717A]">Payload JSON</div>
              <pre className="rounded-[8px] bg-[#09090B] text-zinc-100 p-4 text-[12px] font-mono-num overflow-x-auto leading-relaxed">
                {prettyPayloadJson(inspectDetail.payloadJson)}
              </pre>
            </div>

            {inspectDetail.lastResponseBody && (
              <div className="space-y-1.5">
                <div className="text-[12px] font-medium text-[#71717A]">Phản hồi từ máy chủ đích</div>
                <pre className="rounded-[8px] bg-[#FAFAFA] border border-black/[0.08] p-3 text-[12px] font-mono-num text-[#52525B] overflow-x-auto">
                  {inspectDetail.lastResponseBody}
                </pre>
              </div>
            )}
          </div>
        )}
      </SheetDrawer>

      <ConfirmModal
        open={Boolean(rotateTarget)}
        title="Xoay vòng Webhook Signing Secret"
        description={
          rotateTarget
            ? `Secret cũ của kênh "${rotateTarget.name}" sẽ mất hiệu lực ngay lập tức.`
            : ''
        }
        confirmLabel="Xoay vòng Secret"
        onConfirm={handleRotateConfirmed}
        onClose={() => setRotateTarget(null)}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Xóa kênh định tuyến"
        description={
          deleteTarget
            ? `Kênh "${deleteTarget.name}" (${deleteTarget.webhookUrl}) sẽ bị xóa vĩnh viễn.`
            : ''
        }
        confirmLabel="Xóa kênh"
        destructive
        onConfirm={handleDeleteConfirmed}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
