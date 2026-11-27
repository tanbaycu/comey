import { ArrowsLeftRight } from '@phosphor-icons/react';
import { Play, Radio, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { BankEmblem } from '../components/BankEmblem';
import { CopyButton } from '../components/CopyButton';
import { EmptyState } from '../components/EmptyState';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { SegmentedControl } from '../components/SegmentedControl';
import { SheetDrawer } from '../components/SheetDrawer';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatVnd } from '../lib/format';
import type { BankAccount, SimulationResponse, TransactionItem } from '../lib/types';

export function TransactionsSimulatorPage({
  accounts,
  transactions,
  onReload,
  onPollTransactions,
  onNotify,
  openSimSignal = 0,
}: {
  accounts: BankAccount[];
  transactions: TransactionItem[];
  onReload: () => Promise<void>;
  onPollTransactions?: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  openSimSignal?: number;
}) {
  const [simDrawerOpen, setSimDrawerOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);

  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id || '');
  const [amount, setAmount] = useState(80000);
  const [content, setContent] = useState('SHOP100200');
  const [senderName, setSenderName] = useState('NGUYEN VAN TEST');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResponse['simulation'] | null>(null);

  const [searchCode, setSearchCode] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'live' | 'test'>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    if (openSimSignal > 0) {
      setSimDrawerOpen(true);
    }
  }, [openSimSignal]);

  const selectedAccId = bankAccountId || accounts[0]?.id || '';
  const pollFn = onPollTransactions ?? onReload;

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void pollFn();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, pollFn]);

  async function handleSimulate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccId) {
      onNotify('error', 'Cần thêm ít nhất một tài khoản ngân hàng trước');
      return;
    }
    setSimulating(true);
    try {
      const res = await api.simulator.transfer({
        bankAccountId: selectedAccId,
        amount,
        content,
        senderName,
      });
      setSimResult(res.simulation);
      await onReload();
      onNotify('success', 'Đã thực thi mô phỏng chuyển khoản qua toàn bộ pipeline');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi chạy mô phỏng');
    } finally {
      setSimulating(false);
    }
  }

  const filteredTx = transactions.filter((tx) => {
    if (sourceFilter === 'live' && tx.isTest) return false;
    if (sourceFilter === 'test' && !tx.isTest) return false;
    if (searchCode.trim()) {
      const q = searchCode.trim().toLowerCase();
      return (
        tx.content.toLowerCase().includes(q) ||
        (tx.matchedOrderCode || '').toLowerCase().includes(q) ||
        tx.bankTxId.toLowerCase().includes(q) ||
        tx.bankCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Sổ giao dịch
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5">
            Theo dõi biến động tiền vào đã xác thực DKIM và kiểm tra toàn trình qua trình mô phỏng.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSimDrawerOpen(true)}
          className="cm-btn cm-btn-primary"
        >
          <Play className="w-3.5 h-3.5 fill-current" /> Mô phỏng giao dịch
        </button>
      </div>

      {/* Unified Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="sim-search"
              type="text"
              aria-label="Tìm mã đơn hoặc mã giao dịch"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="Tìm nội dung, mã đơn, mã GD..."
              className="cm-input pl-8 text-[13px] font-mono-num"
            />
          </div>

          <SegmentedControl
            size="sm"
            value={sourceFilter}
            onChange={setSourceFilter}
            ariaLabel="Lọc nguồn giao dịch"
            options={[
              { value: 'all', label: 'Tất cả', count: transactions.length },
              {
                value: 'live',
                label: 'Tiền thật',
                count: transactions.filter((t) => !t.isTest).length,
              },
              {
                value: 'test',
                label: 'Mô phỏng',
                count: transactions.filter((t) => t.isTest).length,
              },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setAutoRefresh((v) => !v)}
          className={`cm-btn h-8 px-3 text-[12.5px] ${
            autoRefresh
              ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
              : 'cm-btn-secondary'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'cm-live-dot' : ''}`} />
          {autoRefresh ? 'Tự động cập nhật: Bật' : 'Tự động cập nhật: Tắt'}
        </button>
      </div>

      {/* Transactions Ledger */}
      <div className="cm-panel overflow-hidden min-w-0">
        {filteredTx.length === 0 ? (
          <EmptyState
            icon={ArrowsLeftRight}
            title="Chưa có giao dịch phù hợp"
            description="Sử dụng trình mô phỏng để kiểm tra parser, đối soát mã đơn và kênh nhận thông báo."
            action={
              <button
                type="button"
                onClick={() => setSimDrawerOpen(true)}
                className="cm-btn cm-btn-primary"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Mô phỏng giao dịch đầu tiên
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                <tr>
                  <th className="px-4 py-2.5">Ngân hàng</th>
                  <th className="px-4 py-2.5">Mã giao dịch</th>
                  <th className="px-4 py-2.5">Số tiền</th>
                  <th className="px-4 py-2.5">Nội dung chuyển khoản</th>
                  <th className="px-4 py-2.5">Mã đơn khớp</th>
                  <th className="px-4 py-2.5">Xác thực</th>
                  <th className="px-4 py-2.5 text-right">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {filteredTx.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className="hover:bg-[#FAFAFA] transition-colors duration-100 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <BankEmblem code={tx.bankCode} size="sm" />
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[12.5px] text-[#52525B]">
                      {tx.bankTxId}
                    </td>
                    <td className="px-4 py-3 font-mono-num font-semibold text-[#047857] whitespace-nowrap">
                      +{formatVnd(tx.amount)}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[12.5px] max-w-xs text-[#09090B]">
                      <div className="flex items-center gap-2 min-w-0">
                        <IdentityAvatar seed={tx.content || tx.bankTxId} size="xs" />
                        <span className="truncate">{tx.content}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-num font-medium text-[#09090B]">
                      {tx.matchedOrderCode || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={statusTone(tx.authStatus)}>{tx.authStatus}</Badge>
                        {tx.isTest && <Badge tone="blue">Sandbox</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-[12.5px] text-[#71717A] whitespace-nowrap">
                      {formatDateTime(tx.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Detail Drawer */}
      <SheetDrawer
        open={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title="Chi tiết giao dịch"
        subtitle={selectedTx ? `${selectedTx.bankCode} (${selectedTx.bankTxId})` : ''}
      >
        {selectedTx && (
          <div className="space-y-5">
            <div className="rounded-[10px] bg-[#ECFDF5]/60 border border-[#A7F3D0] p-4 flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[12px] font-medium text-[#047857]">Số tiền nhận</div>
                <div className="font-mono-num text-[26px] font-semibold tracking-[-0.02em] text-[#047857]">
                  +{formatVnd(selectedTx.amount)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <IdentityAvatar
                  seed={selectedTx.content || selectedTx.bankTxId}
                  size="md"
                  ring="live"
                />
                <BankEmblem code={selectedTx.bankCode} size="md" />
              </div>
            </div>

            <div className="rounded-[10px] border border-black/[0.08] divide-y divide-black/[0.06] text-[13px]">
              {[
                { label: 'Ngân hàng', val: selectedTx.bankCode },
                { label: 'Số tài khoản', val: selectedTx.accountNumber, copy: true },
                { label: 'Mã tham chiếu', val: selectedTx.bankTxId, copy: true },
                { label: 'Nội dung', val: selectedTx.content || '(trống)', copy: Boolean(selectedTx.content) },
                { label: 'Mã đơn khớp', val: selectedTx.matchedOrderCode || '—' },
                { label: 'Trạng thái DKIM', val: selectedTx.authStatus },
                { label: 'Nguồn dữ liệu', val: selectedTx.source },
                { label: 'Thời gian', val: formatDateTime(selectedTx.occurredAt) },
              ].map((row) => (
                <div
                  key={row.label}
                  className="px-4 py-3 flex items-center justify-between gap-3 bg-white"
                >
                  <span className="text-[#71717A] text-[12.5px] shrink-0">{row.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono-num font-medium text-[#09090B] truncate">
                      {row.val}
                    </span>
                    {row.copy && (
                      <CopyButton
                        value={row.val}
                        size="xs"
                        variant="ghost"
                        onCopied={(ok) =>
                          onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép' : 'Lỗi sao chép')
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetDrawer>

      {/* Simulator Drawer */}
      <SheetDrawer
        open={simDrawerOpen}
        onClose={() => setSimDrawerOpen(false)}
        title="Mô phỏng giao dịch"
        subtitle="Giả lập email ngân hàng đi qua Parser, đối soát đơn và gửi thông báo thực tế."
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSimDrawerOpen(false)}
              className="cm-btn cm-btn-secondary"
            >
              Đóng
            </button>
            <button
              type="submit"
              form="sim-run-form"
              disabled={simulating || accounts.length === 0}
              className="cm-btn cm-btn-primary"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {simulating ? 'Đang thực thi...' : 'Chạy mô phỏng'}
            </button>
          </div>
        }
      >
        <form id="sim-run-form" onSubmit={handleSimulate} className="space-y-4">
          <div>
            <label htmlFor="sim-bank-account" className="block text-[12.5px] font-medium mb-1.5">
              Tài khoản nhận
            </label>
            <select
              id="sim-bank-account"
              value={selectedAccId}
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
            <label htmlFor="sim-amount" className="block text-[12.5px] font-medium mb-1.5">
              Số tiền (VNĐ)
            </label>
            <input
              id="sim-amount"
              type="number"
              min={1000}
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="cm-input font-mono-num"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[50000, 80000, 100000, 250000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v)}
                  className={`rounded-[6px] border px-2.5 py-1 text-[12px] font-mono-num font-medium cursor-pointer transition-colors duration-150 ${
                    amount === v
                      ? 'bg-[#09090B] text-white border-[#09090B]'
                      : 'bg-white text-[#52525B] border-black/[0.1] hover:bg-[#F4F4F5]'
                  }`}
                >
                  {v.toLocaleString('vi-VN')}đ
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="sim-content" className="block text-[12.5px] font-medium mb-1.5">
              Nội dung chuyển khoản
            </label>
            <input
              id="sim-content"
              type="text"
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="SHOP100200"
              className="cm-input font-mono-num"
            />
          </div>

          <div>
            <label htmlFor="sim-sender-name" className="block text-[12.5px] font-medium mb-1.5">
              Tên người gửi
            </label>
            <input
              id="sim-sender-name"
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="cm-input"
            />
          </div>

          {simResult && (
            <div className="rounded-[8px] bg-[#09090B] text-zinc-100 p-4 text-[12px] font-mono-num space-y-1.5 overflow-x-auto">
              <div className="text-[#34D399] font-semibold">
                Trạng thái: {simResult.status}
              </div>
              <div className="text-zinc-300">
                Mã đơn khớp: {simResult.matchedOrderCode || 'Không có'} ({simResult.sessionAction || 'Layer 1'})
              </div>
              {simResult.deliveries && simResult.deliveries.length > 0 ? (
                simResult.deliveries.map((d) => (
                  <div key={d.deliveryId} className="text-zinc-300 break-all border-t border-white/10 pt-1.5">
                    {d.eventType} -&gt; {d.targetUrl}: {d.status} (HTTP {d.httpStatus ?? 'err'})
                  </div>
                ))
              ) : (
                <div className="text-zinc-400 border-t border-white/10 pt-1.5">
                  Không có kênh định tuyến nào khớp mẫu nội dung này.
                </div>
              )}
            </div>
          )}
        </form>
      </SheetDrawer>
    </div>
  );
}
