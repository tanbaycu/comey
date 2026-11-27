import { Bank, CheckCircle } from '@phosphor-icons/react';
import { Plus, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { BankLogo, BankTilePicker, getBankMeta } from '../components/BankEmblem';
import { BrandIcon } from '../components/BrandIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { SheetDrawer } from '../components/SheetDrawer';
import { Tip } from '../components/Tooltip';
import { api, ApiError } from '../lib/api';
import type { BankAccount, BankCatalogItem } from '../lib/types';

const SetupWizardModal = lazy(() =>
  import('../components/SetupWizardModal').then((m) => ({ default: m.SetupWizardModal }))
);

function EmvChipSvg() {
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="27"
        height="19"
        rx="3.5"
        fill="#E5E7EB"
        stroke="rgba(9,9,11,0.18)"
      />
      <path
        d="M9 1V19M19 1V19M1 7H9M1 13H9M19 7H27M19 13H27"
        stroke="rgba(9,9,11,0.22)"
        strokeWidth="1"
      />
    </svg>
  );
}

const FEATURED_ONBOARD_BANKS = ['CAKE', 'MB', 'VCB', 'TECHCOMBANK', 'TIMO', 'ACB'] as const;

export function BankAccountsPage({
  accounts,
  banks,
  onReload,
  onReloadRules,
  onReloadAfterSim,
  onNotify,
  openCreateSignal = 0,
  preselectedBankCode,
}: {
  accounts: BankAccount[];
  banks: BankCatalogItem[];
  onReload: () => Promise<void>;
  onReloadRules?: () => Promise<void>;
  onReloadAfterSim?: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  openCreateSignal?: number;
  preselectedBankCode?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bankCode, setBankCode] = useState(preselectedBankCode || 'CAKE');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [strictAuth, setStrictAuth] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [newTokenBanner, setNewTokenBanner] = useState('');
  const [wizardAccount, setWizardAccount] = useState<BankAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null);

  useEffect(() => {
    if (openCreateSignal > 0) {
      if (preselectedBankCode) {
        setBankCode(preselectedBankCode);
      }
      setDrawerOpen(true);
    }
  }, [openCreateSignal, preselectedBankCode]);

  function openForBank(code?: string) {
    setFormError('');
    if (code) setBankCode(code);
    setDrawerOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setCreating(true);
    try {
      const res = await api.bankAccounts.create({
        bankCode,
        accountNumber,
        accountName,
        strictAuth,
      });
      setNewTokenBanner(res.appsScriptToken);
      setAccountNumber('');
      setAccountName('');
      setDrawerOpen(false);
      await onReload();
      setWizardAccount(res.bankAccount);
      onNotify('success', `Đã thêm tài khoản ${res.bankAccount.accountNumber}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Không thể thêm tài khoản';
      setFormError(msg);
      onNotify('error', msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStrict(acc: BankAccount) {
    try {
      await api.bankAccounts.update(acc.id, { strictAuth: !acc.strictAuth });
      await onReload();
      onNotify('success', 'Đã cập nhật chính sách kiểm duyệt DKIM');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi cập nhật');
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    try {
      await api.bankAccounts.remove(deleteTarget.id);
      await Promise.all([onReload(), onReloadRules ? onReloadRules() : Promise.resolve()]);
      onNotify('success', 'Đã xóa tài khoản ngân hàng');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi xóa tài khoản');
    }
  }

  const activeWizard = wizardAccount
    ? accounts.find((a) => a.id === wizardAccount.id) ?? wizardAccount
    : null;

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Tài khoản ngân hàng
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5">
            Hỗ trợ đối soát email tự động cho Cake, MB, Vietcombank, Techcombank, Timo và ACB.
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
          <Plus className="w-4 h-4" /> Thêm tài khoản
        </button>
      </div>

      {newTokenBanner && (
        <div className="cm-panel border-[#A7F3D0] bg-[#ECFDF5]/60 p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="text-[13px] text-[#047857] min-w-0 flex-1 space-y-0.5">
            <div className="font-semibold">
              Token cầu nối Apps Script (chỉ hiển thị một lần sau khi tạo)
            </div>
            <code className="block font-mono-num text-[12.5px] font-semibold text-[#09090B] break-all">
              {newTokenBanner}
            </code>
          </div>
          <CopyButton
            value={newTokenBanner}
            label="Sao chép token"
            variant="dark"
            onCopied={(ok) =>
              onNotify(
                ok ? 'success' : 'error',
                ok ? 'Đã sao chép Apps Script Token' : 'Không thể sao chép'
              )
            }
          />
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="cm-panel overflow-hidden grid lg:grid-cols-12">
          <div className="lg:col-span-6 p-6 sm:p-7 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <span className="cm-kpi-badge cm-kpi-badge-emerald w-10 h-10 rounded-[10px]">
                <Bank size={20} weight="duotone" />
              </span>
              <div className="space-y-1.5">
                <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-[#09090B]">
                  Kết nối tài khoản ngân hàng nhận tiền
                </h3>
                <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                  Mỗi tài khoản sở hữu địa chỉ email chuyển tiếp riêng và mã VietQR EMVCo chuẩn
                  hóa để tự động đối soát tức thì khi tiền về.
                </p>
              </div>
              <ul className="space-y-2 text-[13px] text-[#52525B]">
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>Xác thực chữ ký số DKIM chống giả mạo email ngân hàng</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>Không cần cấp mật khẩu đăng nhập hay OTP internet banking</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>Tương thích 12 ngân hàng Việt Nam và sinh QR động GET /qr</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => openForBank()}
                className="cm-btn cm-btn-primary"
              >
                <Plus className="w-4 h-4" /> Thêm tài khoản đầu tiên
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 bg-[#F5F6F7] p-6 sm:p-7 border-t lg:border-t-0 lg:border-l border-black/[0.07] space-y-5">
            {/* Sculpted Obsidian Virtual Card Preview */}
            <div className="rounded-[14px] bg-[#09090B] text-white p-5 space-y-5 shadow-lg border border-white/10">
              <div className="flex items-center justify-between gap-3">
                <BankLogo code="VCB" size="md" />
                <span className="font-mono-num text-[10.5px] font-semibold text-[#34D399] bg-white/10 border border-white/10 px-2 py-0.5 rounded-[5px]">
                  DKIM VERIFIED
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <EmvChipSvg />
                <span className="font-mono-num text-[15px] font-semibold tracking-[0.06em] text-zinc-100">
                  1019 8842 0019
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>AUTO-FORWARD GMAIL</span>
                <span className="font-mono-num text-zinc-300">VIETQR EMVCO</span>
              </div>
            </div>

            {/* 1-Click Popular Bank Logo Grid */}
            <div className="space-y-2">
              <div className="text-[11.5px] font-medium text-[#71717A]">
                Chọn nhanh ngân hàng phổ biến để kết nối ngay
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FEATURED_ONBOARD_BANKS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => openForBank(code)}
                    className="rounded-[9px] border border-black/[0.08] bg-white hover:border-[#09090B]/30 p-2 flex flex-col items-center gap-1.5 cursor-pointer transition-[border-color,transform] duration-150 active:scale-[0.97]"
                  >
                    <BankLogo code={code} size="card" plate={false} />
                    <span className="text-[11px] font-medium text-[#52525B] truncate w-full text-center">
                      {getBankMeta(code).name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((acc) => {
            const meta = getBankMeta(acc.bankCode);
            return (
              <div
                key={acc.id}
                className="cm-panel cm-card-interactive min-w-0 overflow-hidden flex flex-col justify-between"
              >
                {/* Upper Sculpted Virtual Card Face */}
                <div className="cm-bank-card-face p-5 space-y-4 min-w-0">
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <BankLogo code={acc.bankCode} size="lg" />
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-[#09090B] truncate">
                          {meta.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge tone={acc.strictAuth ? 'green' : 'slate'}>
                            {acc.strictAuth ? 'Strict DKIM' : 'Soft DKIM'}
                          </Badge>
                          <Badge tone={statusTone(acc.forwardingStatus)}>
                            {acc.forwardingStatus}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Tip label="Xóa tài khoản" side="left">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(acc)}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[7px] text-[#71717A] hover:text-[#DC2626] hover:bg-rose-50 cursor-pointer shrink-0 transition-colors duration-150"
                        aria-label={`Xóa tài khoản ${acc.accountNumber}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tip>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num text-[21px] font-semibold tracking-[-0.02em] text-[#09090B] break-all">
                          {acc.accountNumber}
                        </span>
                        <CopyButton
                          value={acc.accountNumber}
                          size="xs"
                          variant="ghost"
                          onCopied={(ok) =>
                            onNotify(
                              ok ? 'success' : 'error',
                              ok ? 'Đã sao chép số tài khoản' : 'Không thể sao chép'
                            )
                          }
                        />
                      </div>
                      <div className="text-[12px] text-[#52525B] uppercase font-medium break-words">
                        {acc.accountName}
                      </div>
                    </div>
                    <EmvChipSvg />
                  </div>
                </div>

                {/* Lower Auto-Forward Operational Dock */}
                <div className="bg-[#F5F6F7]/75 px-5 py-4 border-t border-black/[0.06] space-y-3">
                  <div className="rounded-[8px] bg-white border border-black/[0.08] px-3 py-2.5 flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <BrandIcon id="gmail" size={14} tile />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[#71717A]">
                          Địa chỉ tiếp nhận Auto-Forward
                        </div>
                        <div className="font-mono-num text-[12.5px] font-medium text-[#09090B] truncate">
                          {acc.inboundEmail}
                        </div>
                      </div>
                    </div>
                    <CopyButton
                      value={acc.inboundEmail}
                      size="xs"
                      onCopied={(ok) =>
                        onNotify(
                          ok ? 'success' : 'error',
                          ok ? 'Đã sao chép địa chỉ email tiếp nhận' : 'Không thể sao chép'
                        )
                      }
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Tip label="Chuyển chế độ xác thực chữ ký email DKIM">
                      <button
                        type="button"
                        onClick={() => void handleToggleStrict(acc)}
                        className="min-h-[34px] inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] cursor-pointer"
                      >
                        <ShieldCheck
                          className={`w-4 h-4 ${acc.strictAuth ? 'text-[#047857]' : 'text-[#A1A1AA]'}`}
                        />
                        <span>DKIM: {acc.strictAuth ? 'Strict' : 'Soft'}</span>
                      </button>
                    </Tip>

                    <button
                      type="button"
                      onClick={() => setWizardAccount(acc)}
                      className="cm-btn cm-btn-secondary h-8 text-[12.5px]"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Thiết lập kết nối
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SheetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title="Thêm tài khoản ngân hàng"
        subtitle="Khai báo tài khoản nhận tiền để sinh email tiếp nhận và cấu hình kiểm duyệt DKIM."
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
              form="ba-create-form"
              disabled={creating}
              className="cm-btn cm-btn-primary"
            >
              {creating ? 'Đang tạo...' : 'Lưu tài khoản'}
            </button>
          </div>
        }
      >
        <form id="ba-create-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <div className="block text-[12.5px] font-medium text-[#09090B] mb-2">
              Ngân hàng phát hành
            </div>
            <BankTilePicker banks={banks} value={bankCode} onChange={setBankCode} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="ba-account-number"
                className="block text-[12.5px] font-medium text-[#09090B] mb-1.5"
              >
                Số tài khoản
              </label>
              <input
                id="ba-account-number"
                type="text"
                required
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="0835117727"
                className="cm-input font-mono-num"
              />
            </div>

            <div>
              <label
                htmlFor="ba-account-name"
                className="block text-[12.5px] font-medium text-[#09090B] mb-1.5"
              >
                Tên chủ tài khoản
              </label>
              <input
                id="ba-account-name"
                type="text"
                required
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="TRAN MINH TAN"
                className="cm-input uppercase"
              />
            </div>
          </div>

          <label
            htmlFor="ba-strict-auth"
            className="flex items-start gap-2.5 rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] p-3.5 text-[12.5px] text-[#52525B] cursor-pointer leading-relaxed"
          >
            <input
              id="ba-strict-auth"
              type="checkbox"
              checked={strictAuth}
              onChange={(e) => setStrictAuth(e.target.checked)}
              className="h-4 w-4 shrink-0 mt-0.5 rounded accent-[#047857]"
            />
            <span>
              <span className="font-semibold text-[#09090B] block mb-0.5">
                Bật Strict DKIM Anti-Spoofing
              </span>
              Email không đạt chữ ký DKIM của tên miền ngân hàng sẽ được đưa vào Hộp cách ly thay
              vì tự động duyệt.
            </span>
          </label>

          {formError && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
              {formError}
            </div>
          )}
        </form>
      </SheetDrawer>

      {activeWizard && (
        <Suspense fallback={null}>
          <SetupWizardModal
            account={activeWizard}
            onClose={() => setWizardAccount(null)}
            onRefreshAll={onReload}
            onReloadRules={onReloadRules}
            onReloadAfterSim={onReloadAfterSim}
            onNotify={onNotify}
          />
        </Suspense>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Xóa tài khoản ngân hàng"
        description={
          deleteTarget
            ? `Tài khoản ${deleteTarget.bankCode} (${deleteTarget.accountNumber}) và toàn bộ luật định tuyến liên kết sẽ bị xóa vĩnh viễn.`
            : ''
        }
        confirmLabel="Xóa tài khoản"
        destructive
        onConfirm={handleDeleteConfirmed}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
