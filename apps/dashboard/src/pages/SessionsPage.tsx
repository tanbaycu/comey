import { QrCode as PhQrCode } from '@phosphor-icons/react';
import { ExternalLink, Play, Plus, QrCode, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { BankEmblem } from '../components/BankEmblem';
import { BrandIcon } from '../components/BrandIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { api, ApiError } from '../lib/api';
import { formatRelativeExpiry, formatVnd } from '../lib/format';
import type { BankAccount, PaymentSessionItem } from '../lib/types';

function formatTtlClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function SessionsPage({
  accounts,
  sessions,
  onReload,
  onReloadAfterSim,
  onNotify,
  dynamicQrSignal = 0,
}: {
  accounts: BankAccount[];
  sessions: PaymentSessionItem[];
  onReload: () => Promise<void>;
  onReloadAfterSim?: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  dynamicQrSignal?: number;
}) {
  const [studioTab, setStudioTab] = useState<'sessions' | 'dynamic_qr'>('sessions');

  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id || '');
  const [orderCode, setOrderCode] = useState(
    () => `SHOP${Math.floor(100000 + Math.random() * 899999)}`
  );
  const [amount, setAmount] = useState(80000);
  const [ttlSeconds, setTtlSeconds] = useState(600);
  const [exactMatchOnly, setExactMatchOnly] = useState(false);
  const [returnUrl, setReturnUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [testingPayId, setTestingPayId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PaymentSessionItem | null>(null);

  const [qrAccountId, setQrAccountId] = useState(accounts[0]?.id || '');
  const [qrAmount, setQrAmount] = useState('50000');
  const [qrDes, setQrDes] = useState('DONHANG123');
  const [qrFormat, setQrFormat] = useState<'png' | 'svg'>('png');

  const [createdPreview, setCreatedPreview] = useState<{
    sessionId: string;
    bankAccountId: string;
    bankCode: string;
    accountNumber: string;
    checkoutUrl: string;
    qrPngUrl: string;
    svg: string;
    orderCode: string;
    amount: number;
    ttlSeconds: number;
  } | null>(null);

  useEffect(() => {
    if (dynamicQrSignal > 0) {
      setStudioTab('dynamic_qr');
    }
  }, [dynamicQrSignal]);

  const selectedAccount =
    accounts.find((a) => a.id === (bankAccountId || accounts[0]?.id)) || accounts[0];

  const activeQrAccount =
    accounts.find((a) => a.id === qrAccountId) ?? selectedAccount ?? accounts[0];

  const qrParams = new URLSearchParams();
  if (activeQrAccount) {
    qrParams.set('bank', activeQrAccount.bankCode);
    qrParams.set('acc', activeQrAccount.accountNumber);
  }
  const parsedQrAmt = Number(qrAmount.trim());
  if (Number.isInteger(parsedQrAmt) && parsedQrAmt > 0) {
    qrParams.set('amount', String(parsedQrAmt));
  }
  if (qrDes.trim()) {
    qrParams.set('des', qrDes.trim());
  }
  qrParams.set('format', qrFormat);
  const relQrUrl = activeQrAccount ? `/qr?${qrParams.toString()}` : '';
  const absQrUrl =
    relQrUrl && typeof window !== 'undefined' ? `${window.location.origin}${relQrUrl}` : relQrUrl;
  const htmlImgSnippet = absQrUrl
    ? `<img src="${absQrUrl}" alt="VietQR thanh toan" width="240" height="240" />`
    : '';
  const markdownSnippet = absQrUrl ? `![VietQR Thanh toan](${absQrUrl})` : '';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!selectedAccount) {
      setFormError('Vui lòng thêm ít nhất một tài khoản ngân hàng trước');
      return;
    }
    setCreating(true);
    try {
      const res = await api.sessions.create({
        bankAccountId: selectedAccount.id,
        orderCode,
        amount,
        ttlSeconds,
        exactMatchOnly,
        returnUrl: returnUrl.trim() || undefined,
      });
      setCreatedPreview({
        sessionId: res.session.id,
        bankAccountId: res.session.bankAccountId || selectedAccount.id,
        bankCode: res.session.bankCode || selectedAccount.bankCode,
        accountNumber: res.session.accountNumber || selectedAccount.accountNumber,
        checkoutUrl: res.checkoutUrl,
        qrPngUrl: res.qrPngUrl,
        svg: res.vietqr.svg,
        orderCode: res.session.orderCode,
        amount: res.session.expectedAmount,
        ttlSeconds,
      });
      setOrderCode(`SHOP${Math.floor(100000 + Math.random() * 899999)}`);
      await onReload();
      onNotify('success', `Đã tạo link thanh toán /p/${res.session.shortId}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Không thể tạo phiên';
      setFormError(msg);
      onNotify('error', msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleQuickTestPay(sess: {
    id: string;
    bankAccountId?: string;
    bankCode?: string;
    accountNumber?: string;
    orderCode: string;
    amount: number;
  }) {
    const matchedAccountId =
      sess.bankAccountId ||
      (sess.bankCode && sess.accountNumber
        ? accounts.find(
            (a) => a.bankCode === sess.bankCode && a.accountNumber === sess.accountNumber
          )?.id
        : undefined) ||
      selectedAccount?.id;
    if (!matchedAccountId) return;
    setTestingPayId(sess.id);
    try {
      await api.simulator.transfer({
        bankAccountId: matchedAccountId,
        amount: sess.amount,
        content: sess.orderCode,
        senderName: 'CHECKOUT TESTER',
      });
      await (onReloadAfterSim ? onReloadAfterSim() : onReload());
      onNotify('success', `Đã giả lập thanh toán cho đơn ${sess.orderCode}`);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể giả lập');
    } finally {
      setTestingPayId(null);
    }
  }

  async function handleCancelConfirmed() {
    if (!cancelTarget) return;
    try {
      await api.sessions.cancel(cancelTarget.id);
      await onReload();
      onNotify('success', 'Đã hủy phiên thanh toán');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể hủy phiên');
    }
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Thanh toán &amp; VietQR
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5">
            Tạo trang thanh toán có kiểm soát thời hạn và số tiền, hoặc sinh liên kết ảnh VietQR động
            không cần lưu phiên.
          </p>
        </div>

        <SegmentedControl
          value={studioTab}
          onChange={setStudioTab}
          ariaLabel="Chọn chế độ VietQR"
          options={[
            { value: 'sessions', label: 'Phiên thanh toán', count: sessions.length },
            { value: 'dynamic_qr', label: 'Ảnh VietQR động' },
          ]}
        />
      </div>

      {studioTab === 'sessions' ? (
        <div className="space-y-6 min-w-0">
          <div className="grid gap-5 lg:grid-cols-12 items-start">
            <form
              onSubmit={handleCreate}
              className="lg:col-span-7 min-w-0 cm-panel p-5 space-y-4"
            >
              <div>
                <h3 className="text-[14px] font-semibold text-[#09090B]">
                  Khởi tạo Link Thanh Toán Checkout
                </h3>
                <p className="text-[12.5px] text-[#71717A] mt-0.5">
                  Trang <code className="font-mono-num">/p/:shortId</code> tự động kiểm tra thiếu
                  tiền, chuyển dư và đếm ngược hết hạn.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="sess-bank-account" className="block text-[12.5px] font-medium mb-1">
                    Tài khoản nhận
                  </label>
                  <select
                    id="sess-bank-account"
                    value={selectedAccount?.id || ''}
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
                <div className="min-w-0">
                  <label htmlFor="sess-order-code" className="block text-[12.5px] font-medium mb-1">
                    Mã đơn hàng
                  </label>
                  <input
                    id="sess-order-code"
                    type="text"
                    required
                    value={orderCode}
                    onChange={(e) => setOrderCode(e.target.value)}
                    className="cm-input font-mono-num"
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="sess-amount" className="block text-[12.5px] font-medium mb-1">
                    Số tiền (VNĐ)
                  </label>
                  <input
                    id="sess-amount"
                    type="number"
                    min={1000}
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="cm-input font-mono-num"
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="sess-ttl" className="block text-[12.5px] font-medium mb-1">
                    Thời hạn (giây)
                  </label>
                  <input
                    id="sess-ttl"
                    type="number"
                    min={60}
                    value={ttlSeconds}
                    onChange={(e) => setTtlSeconds(Number(e.target.value))}
                    className="cm-input font-mono-num"
                  />
                </div>
              </div>

              <div className="min-w-0">
                <label htmlFor="sess-return-url" className="block text-[12.5px] font-medium mb-1">
                  URL chuyển hướng sau thanh toán (tùy chọn)
                </label>
                <input
                  id="sess-return-url"
                  type="url"
                  value={returnUrl}
                  onChange={(e) => setReturnUrl(e.target.value)}
                  placeholder="https://your-shop.com/order/success"
                  className="cm-input font-mono-num"
                />
              </div>

              <label
                htmlFor="sess-exact-match"
                className="flex items-start gap-2.5 text-[12.5px] text-[#52525B] cursor-pointer leading-relaxed"
              >
                <input
                  id="sess-exact-match"
                  type="checkbox"
                  checked={exactMatchOnly}
                  onChange={(e) => setExactMatchOnly(e.target.checked)}
                  className="h-4 w-4 shrink-0 mt-0.5 accent-[#047857]"
                />
                <span>
                  Giữ trạng thái duyệt thủ công (overpaid_review) nếu khách chuyển dư tiền
                </span>
              </label>

              {formError && (
                <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={creating || accounts.length === 0}
                className="cm-btn cm-btn-primary w-full sm:w-auto"
              >
                <Plus className="w-4 h-4" />
                {creating ? 'Đang khởi tạo...' : 'Tạo Link Checkout QR'}
              </button>
            </form>

            {/* Right: Minimalist Obsidian Receipt Ticket Preview */}
            <div className="lg:col-span-5 min-w-0 cm-panel overflow-hidden">
              <div className="bg-[#09090B] text-white px-5 py-3.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium truncate">
                  {createdPreview ? 'Biên nhận Checkout đã tạo' : 'Xem trước thẻ thanh toán'}
                </span>
                <span className="rounded-[5px] bg-white/10 text-zinc-100 px-2 py-0.5 text-[11.5px] font-mono-num font-medium shrink-0">
                  {formatTtlClock(createdPreview?.ttlSeconds ?? ttlSeconds)}
                </span>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4 min-w-0">
                  {createdPreview ? (
                    <div
                      className="w-28 h-28 rounded-[8px] bg-white p-2 border border-black/[0.08] shrink-0 [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: createdPreview.svg }}
                    />
                  ) : (
                    <div className="w-28 h-28 rounded-[8px] bg-[#FAFAFA] border border-dashed border-black/[0.14] flex flex-col items-center justify-center text-center text-[11.5px] text-[#71717A] p-2 shrink-0 gap-1">
                      <QrCode className="w-5 h-5 text-[#A1A1AA]" />
                      <span>Mã VietQR</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-mono-num text-[20px] font-semibold tracking-[-0.02em] text-[#09090B] truncate">
                      {formatVnd(createdPreview?.amount ?? amount)}
                    </div>
                    <div className="font-mono-num text-[12.5px] font-medium text-[#047857] break-all">
                      {createdPreview?.orderCode ?? orderCode}
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px] text-[#71717A] font-mono-num pt-0.5">
                      {createdPreview ? (
                        <>
                          <BankEmblem code={createdPreview.bankCode} size="sm" />
                          <span className="truncate">{createdPreview.accountNumber}</span>
                        </>
                      ) : selectedAccount ? (
                        <>
                          <BankEmblem code={selectedAccount.bankCode} size="sm" />
                          <span className="truncate">{selectedAccount.accountNumber}</span>
                        </>
                      ) : (
                        <span>Chưa chọn tài khoản</span>
                      )}
                    </div>
                  </div>
                </div>

                {createdPreview && (
                  <div className="cm-ticket-notch space-y-2.5 pt-3 border-t border-dashed border-black/[0.1]">
                    <div className="font-mono-num text-[12px] bg-[#FAFAFA] border border-black/[0.08] rounded-[7px] px-3 py-2 text-[#52525B] break-all">
                      {createdPreview.checkoutUrl}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton
                        value={createdPreview.checkoutUrl}
                        label="Sao chép Link"
                        variant="dark"
                        onCopied={(ok) =>
                          onNotify(
                            ok ? 'success' : 'error',
                            ok ? 'Đã sao chép link Checkout' : 'Lỗi sao chép'
                          )
                        }
                      />
                      <a
                        href={createdPreview.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="cm-btn cm-btn-secondary h-8 px-3 text-[12px]"
                      >
                        Mở trang <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        disabled={testingPayId === createdPreview.sessionId}
                        onClick={() =>
                          void handleQuickTestPay({
                            id: createdPreview.sessionId,
                            bankAccountId: createdPreview.bankAccountId,
                            bankCode: createdPreview.bankCode,
                            accountNumber: createdPreview.accountNumber,
                            orderCode: createdPreview.orderCode,
                            amount: createdPreview.amount,
                          })
                        }
                        className="cm-btn cm-btn-emerald h-8 px-3 text-[12px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {testingPayId === createdPreview.sessionId ? 'Đang chạy...' : 'Test Paid'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="cm-panel overflow-hidden min-w-0">
            <div className="px-5 py-3.5 border-b border-black/[0.06]">
              <h3 className="text-[13.5px] font-semibold text-[#09090B]">
                Danh sách phiên thanh toán ({sessions.length})
              </h3>
            </div>
            {sessions.length === 0 ? (
              <EmptyState
                icon={PhQrCode}
                title="Chưa có phiên thanh toán nào"
                description="Khởi tạo link thanh toán Checkout QR ở khung bên trên để khách hàng quét mã tự động đối soát."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                    <tr>
                      <th className="px-4 py-2.5">Mã đơn</th>
                      <th className="px-4 py-2.5">Số tiền</th>
                      <th className="px-4 py-2.5">Trạng thái</th>
                      <th className="px-4 py-2.5">Thời hạn</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-[#FAFAFA] transition-colors duration-100">
                        <td className="px-4 py-3 font-mono-num">
                          <div className="flex items-center gap-2.5">
                            <BankEmblem code={s.bankCode || 'BANK'} size="sm" />
                            <div>
                              <div className="font-semibold text-[#09090B]">{s.orderCode}</div>
                              <div className="text-[11.5px] text-[#71717A]">
                                /p/{s.shortId} ({s.accountNumber})
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-num">
                          <div className="font-semibold text-[#09090B]">
                            {formatVnd(s.expectedAmount)}
                          </div>
                          {s.receivedAmount > 0 && (
                            <div className="text-[11.5px] text-[#047857]">
                              Đã nhận {formatVnd(s.receivedAmount)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                          {s.overpaid && (
                            <span className="ml-1.5 text-[11.5px] text-amber-800 font-medium">
                              +{formatVnd(s.excessAmount)}
                            </span>
                          )}
                          {s.status === 'underpaid' && (
                            <span className="ml-1.5 text-[11.5px] text-amber-800 font-medium">
                              Thiếu {formatVnd(s.missingAmount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-[#71717A]">
                          {formatRelativeExpiry(s.expiresAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={`/p/${s.shortId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                            >
                              Mở QR <ExternalLink className="w-3 h-3" />
                            </a>
                            {(s.status === 'pending' || s.status === 'underpaid') && (
                              <>
                                <button
                                  type="button"
                                  disabled={testingPayId === s.id}
                                  onClick={() =>
                                    void handleQuickTestPay({
                                      id: s.id,
                                      bankAccountId: s.bankAccountId,
                                      bankCode: s.bankCode,
                                      accountNumber: s.accountNumber,
                                      orderCode: s.orderCode,
                                      amount: s.expectedAmount,
                                    })
                                  }
                                  className="cm-btn h-8 px-2.5 text-[12px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] hover:bg-[#D1FAE5]"
                                >
                                  <Play className="w-3 h-3 fill-current" /> Test Paid
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelTarget(s)}
                                  className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px] text-[#DC2626] border-rose-200 hover:bg-rose-50"
                                >
                                  <XCircle className="w-3 h-3" /> Hủy
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab 2: Dedicated Dynamic GET /qr Studio */
        <div className="cm-panel p-6 space-y-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[#09090B]">
                Trình tạo ảnh VietQR động (<code className="font-mono-num">GET /qr</code>)
              </h3>
              <p className="text-[12.5px] text-[#71717A] mt-0.5">
                Nhúng thẳng URL ảnh PNG hoặc SVG vào email hóa đơn, Telegram Bot, Google Sheets hoặc
                website mà không cần tạo phiên trong cơ sở dữ liệu.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[#52525B]">
                <span>Nhúng trực tiếp vào:</span>
                <span className="inline-flex items-center gap-1 rounded-[6px] border border-black/[0.08] bg-[#FAFAFA] px-2 py-0.5">
                  <BrandIcon id="gmail" size={13} /> Gmail
                </span>
                <span className="inline-flex items-center gap-1 rounded-[6px] border border-black/[0.08] bg-[#FAFAFA] px-2 py-0.5">
                  <BrandIcon id="telegram" size={13} /> Telegram
                </span>
                <span className="inline-flex items-center gap-1 rounded-[6px] border border-black/[0.08] bg-[#FAFAFA] px-2 py-0.5">
                  <BrandIcon id="discord" size={13} /> Discord
                </span>
                <span className="inline-flex items-center gap-1 rounded-[6px] border border-black/[0.08] bg-[#FAFAFA] px-2 py-0.5">
                  <BrandIcon id="google-sheets" size={13} /> Google Sheets
                </span>
              </div>
            </div>
            <Badge tone="green">Edge Cached 3600s</Badge>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_230px] items-start">
            <div className="space-y-4 min-w-0">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="dyn-qr-acc" className="block text-[12px] font-medium mb-1">
                    Tài khoản nhận
                  </label>
                  <select
                    id="dyn-qr-acc"
                    value={activeQrAccount?.id || ''}
                    onChange={(e) => setQrAccountId(e.target.value)}
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
                  <label htmlFor="dyn-qr-amount" className="block text-[12px] font-medium mb-1">
                    Số tiền (trống = tùy ý)
                  </label>
                  <input
                    id="dyn-qr-amount"
                    type="number"
                    min={0}
                    value={qrAmount}
                    onChange={(e) => setQrAmount(e.target.value)}
                    placeholder="50000"
                    className="cm-input font-mono-num"
                  />
                </div>
                <div>
                  <label htmlFor="dyn-qr-des" className="block text-[12px] font-medium mb-1">
                    Nội dung chuyển khoản
                  </label>
                  <input
                    id="dyn-qr-des"
                    type="text"
                    maxLength={99}
                    value={qrDes}
                    onChange={(e) => setQrDes(e.target.value)}
                    placeholder="DONHANG123"
                    className="cm-input font-mono-num"
                  />
                </div>
                <div>
                  <label htmlFor="dyn-qr-format" className="block text-[12px] font-medium mb-1">
                    Định dạng ảnh
                  </label>
                  <select
                    id="dyn-qr-format"
                    value={qrFormat}
                    onChange={(e) => setQrFormat(e.target.value === 'svg' ? 'svg' : 'png')}
                    className="cm-input"
                  >
                    <option value="png">PNG (image/png)</option>
                    <option value="svg">SVG vector</option>
                  </select>
                </div>
              </div>

              {relQrUrl ? (
                <div className="space-y-3">
                  <div className="font-mono-num text-[12px] bg-[#FAFAFA] border border-black/[0.08] rounded-[7px] px-3.5 py-2.5 text-[#09090B] break-all">
                    {absQrUrl}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton
                      value={absQrUrl}
                      label="Sao chép URL ảnh"
                      variant="dark"
                      onCopied={(ok) =>
                        onNotify(
                          ok ? 'success' : 'error',
                          ok ? 'Đã sao chép URL ảnh VietQR' : 'Lỗi sao chép'
                        )
                      }
                    />
                    <CopyButton
                      value={htmlImgSnippet}
                      label="Thẻ HTML <img>"
                      onCopied={(ok) =>
                        onNotify(
                          ok ? 'success' : 'error',
                          ok ? 'Đã sao chép thẻ HTML' : 'Lỗi sao chép'
                        )
                      }
                    />
                    <CopyButton
                      value={markdownSnippet}
                      label="Markdown"
                      onCopied={(ok) =>
                        onNotify(
                          ok ? 'success' : 'error',
                          ok ? 'Đã sao chép Markdown' : 'Lỗi sao chép'
                        )
                      }
                    />
                    <a
                      href={relQrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="cm-btn cm-btn-secondary h-8 text-[12px]"
                    >
                      Mở trực tiếp <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-[#71717A]">
                  Cần khai báo ít nhất một tài khoản ngân hàng để tạo liên kết ảnh VietQR động.
                </p>
              )}
            </div>

            <div className="flex flex-col items-center justify-center rounded-[10px] border border-black/[0.08] bg-[#FAFAFA] p-4">
              {relQrUrl ? (
                <img
                  src={relQrUrl}
                  alt="Xem trước VietQR động"
                  className="w-44 h-44 rounded-[8px] bg-white border border-black/[0.08] object-contain p-2"
                />
              ) : (
                <div className="w-44 h-44 rounded-[8px] bg-white border border-dashed border-black/[0.14] grid place-items-center text-[12px] text-[#71717A]">
                  Chưa có tài khoản
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(cancelTarget)}
        title="Hủy phiên thanh toán"
        description={
          cancelTarget
            ? `Phiên ${cancelTarget.orderCode} (/p/${cancelTarget.shortId}) sẽ đóng lại ngay lập tức.`
            : ''
        }
        confirmLabel="Hủy phiên"
        destructive
        onConfirm={handleCancelConfirmed}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
