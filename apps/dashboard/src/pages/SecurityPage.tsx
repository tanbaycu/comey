import {
  Fingerprint,
  Key as PhKey,
  LockKey,
  ShieldCheck as PhShieldCheck,
} from '@phosphor-icons/react';
import { KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { ConfirmModal } from '../components/ConfirmModal';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditLogItem, SecuritySummary } from '../lib/types';

export function SecurityPage({
  summary,
  auditLogs,
  onReload,
  onLoggedOutAll,
  onNotify,
}: {
  summary: SecuritySummary | null;
  auditLogs: AuditLogItem[];
  onReload: () => Promise<void>;
  onLoggedOutAll: () => void;
  onNotify: (kind: 'success' | 'error', text: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (
      newPassword.length < 8 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      setPwError('Mật khẩu mới cần tối thiểu 8 ký tự gồm cả chữ cái và chữ số');
      return;
    }

    setChangingPw(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      await onReload();
      onNotify('success', 'Đã đổi mật khẩu và thu hồi các phiên đăng nhập khác');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Không thể đổi mật khẩu');
    } finally {
      setChangingPw(false);
    }
  }

  async function handleLogoutAll() {
    try {
      await api.auth.logoutAll();
      onLoggedOutAll();
      onNotify('success', 'Đã đăng xuất khỏi tất cả thiết bị');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể đăng xuất');
    }
  }

  const totalAccounts = summary?.totalAccounts ?? 0;
  const strictAccounts = summary?.strictAuthAccounts ?? 0;
  const dkimBadgeTone =
    totalAccounts === 0 ? 'slate' : strictAccounts === totalAccounts ? 'green' : 'amber';
  const dkimBadgeLabel =
    totalAccounts === 0
      ? 'Chưa có tài khoản'
      : strictAccounts === totalAccounts
        ? '100% Strict DKIM'
        : 'Cần rà soát';

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
          Bảo mật &amp; Nhật ký kiểm toán
        </h2>
        <p className="text-[13px] text-[#71717A] mt-0.5">
          Giám sát trạng thái xác thực DKIM, phòng vệ SSRF, kiểm soát phiên đăng nhập và nhật ký
          thao tác nhạy cảm.
        </p>
      </div>

      {/* Unified 4-Metric Hairline Posture Strip */}
      <div className="cm-panel grid sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06]">
        <div className="p-5 min-w-0">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
            <span className="truncate">Xác thực DKIM ngân hàng</span>
            <span className="cm-kpi-badge cm-kpi-badge-emerald">
              <PhShieldCheck size={15} weight="duotone" />
            </span>
          </div>
          <div className="mt-2 font-mono-num text-[22px] font-semibold text-[#09090B]">
            {strictAccounts}/{totalAccounts} TK
          </div>
          <div className="mt-1.5">
            <Badge tone={dkimBadgeTone}>{dkimBadgeLabel}</Badge>
          </div>
        </div>

        <div className="p-5 min-w-0">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
            <span className="truncate">Lớp bảo vệ mạng &amp; CSRF</span>
            <span className="cm-kpi-badge">
              <LockKey size={15} weight="duotone" />
            </span>
          </div>
          <div className="mt-2 text-[17px] font-semibold text-[#09090B]">SSRF &amp; CSRF Guard</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="green">Chặn IP nội bộ</Badge>
            <Badge tone="green">Chặn 3xx</Badge>
          </div>
        </div>

        <div className="p-5 min-w-0">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
            <span className="truncate">API Keys đang hoạt động</span>
            <span className="cm-kpi-badge">
              <PhKey size={15} weight="duotone" />
            </span>
          </div>
          <div className="mt-2 font-mono-num text-[22px] font-semibold text-[#09090B]">
            {summary?.activeApiKeys ?? 0} keys
          </div>
          <div className="mt-1 text-[12px] text-[#71717A]">Lưu giá trị băm SHA-256</div>
        </div>

        <div className="p-5 min-w-0">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#71717A]">
            <span className="truncate">Sự kiện Audit đã ghi</span>
            <span className="cm-kpi-badge">
              <Fingerprint size={15} weight="duotone" />
            </span>
          </div>
          <div className="mt-2 font-mono-num text-[22px] font-semibold text-[#09090B]">
            {summary?.recentAuditCount ?? auditLogs.length} bản ghi
          </div>
          <div className="mt-1 text-[12px] text-[#71717A]">Lưu giữ tự động 90 ngày</div>
        </div>
      </div>

      {/* Password & Session Management */}
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={handleChangePassword} className="cm-panel p-5 space-y-4 min-w-0">
          <div>
            <h3 className="text-[14px] font-semibold text-[#09090B] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#047857]" /> Đổi mật khẩu tài khoản
            </h3>
            <p className="text-[12.5px] text-[#71717A] mt-0.5">
              Mọi phiên đăng nhập trên các trình duyệt khác sẽ tự động hết hiệu lực sau khi đổi.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="sec-current-password"
                className="block text-[12.5px] font-medium mb-1"
              >
                Mật khẩu hiện tại
              </label>
              <input
                id="sec-current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="cm-input"
              />
            </div>
            <div>
              <label htmlFor="sec-new-password" className="block text-[12.5px] font-medium mb-1">
                Mật khẩu mới
              </label>
              <input
                id="sec-new-password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 8 ký tự gồm chữ và số"
                className="cm-input"
              />
            </div>
          </div>

          {pwError && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
              {pwError}
            </div>
          )}

          <button type="submit" disabled={changingPw} className="cm-btn cm-btn-primary">
            {changingPw ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
          </button>
        </form>

        <div className="cm-panel p-5 flex flex-col justify-between gap-4 min-w-0">
          <div className="space-y-2">
            <h3 className="text-[14px] font-semibold text-[#09090B] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#52525B]" /> Quản lý phiên đăng nhập
            </h3>
            <p className="text-[13px] text-[#52525B] leading-relaxed">
              Thu hồi ngay toàn bộ cookie phiên làm việc đang mở trên các thiết bị khác nếu nghi ngờ
              truy cập trái phép.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setConfirmLogoutAll(true)}
              className="cm-btn cm-btn-secondary text-[#DC2626] border-rose-200 hover:bg-rose-50"
            >
              <LogOut className="w-4 h-4" /> Đăng xuất khỏi mọi thiết bị
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="cm-panel overflow-hidden min-w-0">
        <div className="px-5 py-3.5 border-b border-black/[0.06] flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-[#09090B] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#047857]" />
            Nhật ký kiểm toán bảo mật ({auditLogs.length})
          </h3>
        </div>
        {auditLogs.length === 0 ? (
          <div className="p-8 text-[13px] text-[#71717A] text-center">
            Chưa có sự kiện bảo mật nào được ghi nhận.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                <tr>
                  <th className="px-4 py-2.5">Hành động</th>
                  <th className="px-4 py-2.5">Tác nhân</th>
                  <th className="px-4 py-2.5">Tài nguyên</th>
                  <th className="px-4 py-2.5">IP Hash</th>
                  <th className="px-4 py-2.5 text-right">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#FAFAFA] transition-colors duration-100">
                    <td className="px-4 py-3 font-mono-num font-medium text-[#09090B]">
                      {log.action}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <IdentityAvatar seed={log.actorId || log.actorType} size="xs" />
                        <Badge tone="slate">{log.actorType}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[12.5px] text-[#52525B]">
                      {log.resourceType ? `${log.resourceType}:${log.resourceId || '—'}` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[12.5px] text-[#52525B]">
                      {log.ipHash || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-[12.5px] text-[#71717A] whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmLogoutAll}
        title="Đăng xuất khỏi mọi thiết bị"
        description="Toàn bộ cookie phiên hiện tại trên các trình duyệt sẽ bị hủy ngay lập tức."
        confirmLabel="Đăng xuất tất cả"
        destructive
        onConfirm={handleLogoutAll}
        onClose={() => setConfirmLogoutAll(false)}
      />
    </div>
  );
}
