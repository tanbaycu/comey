import {
  CheckCircle as PhCheckCircle,
  EnvelopeSimple,
  Fingerprint,
  Key as PhKey,
  LockKey,
  QrCode as PhQrCode,
  ShareNetwork,
  ShieldCheck as PhShieldCheck,
} from '@phosphor-icons/react';
import { ArrowRight, Eye, EyeOff, Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { UserInfo, WorkspaceInfo } from '../lib/types';
import { BANK_CODES_ALL, BankEmblem, BankLogo } from './BankEmblem';
import { BrandIcon, ChannelBadgeIcon, ComeyMark } from './BrandIcon';
import { IdentityAvatar } from './IdentityAvatar';
import { SegmentedControl } from './SegmentedControl';

function scorePassword(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: 'Chưa nhập', color: 'bg-zinc-200' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { score: 1, label: 'Yếu (cần chữ + số, ≥ 8 ký tự)', color: 'bg-rose-500' };
  if (s === 2) return { score: 2, label: 'Đạt chuẩn', color: 'bg-amber-500' };
  return { score: 3, label: 'Mạnh', color: 'bg-[#047857]' };
}

export function LandingAuthView({
  onAuthenticated,
}: {
  onAuthenticated: (user: UserInfo, workspace: WorkspaceInfo) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const [simScenario, setSimScenario] = useState<'verified' | 'spoof' | 'nocode'>('verified');

  const pwStrength = scorePassword(password);

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setFieldErrors({});
    setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const nextErrs: { email?: string; password?: string } = {};

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      nextErrs.email = 'Vui lòng nhập email hợp lệ';
    }
    if (password.length < 8) {
      nextErrs.password = 'Mật khẩu cần ít nhất 8 ký tự';
    } else if (mode === 'register' && (!/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      nextErrs.password = 'Mật khẩu cần chứa ít nhất 1 chữ cái và 1 chữ số';
    }

    if (nextErrs.email || nextErrs.password) {
      setFieldErrors(nextErrs);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.auth.login(cleanEmail, password);
        onAuthenticated(res.user, res.workspace);
      } else {
        const res = await api.auth.register({
          email: cleanEmail,
          password,
          name: name.trim() || cleanEmail.split('@')[0] || 'Owner',
          workspaceName: workspaceName.trim() || undefined,
        });
        onAuthenticated(res.user, res.workspace);
      }
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Không thể xác thực, vui lòng thử lại'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7] text-[#09090B]">
      <a className="skip-link" href="#top">
        Chuyển tới nội dung chính
      </a>

      <header className="sticky top-0 z-30 bg-[#FAFAFA] border-b border-black/[0.08]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5 text-[#09090B] no-underline">
            <ComeyMark size={28} />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Comey</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-[13.5px] font-medium text-[#52525B]">
            <a href="#pipeline" className="hover:text-[#09090B] transition-colors duration-150">
              Kiến trúc
            </a>
            <a href="#integrations" className="hover:text-[#09090B] transition-colors duration-150">
              Hệ sinh thái
            </a>
            <a href="#workflow" className="hover:text-[#09090B] transition-colors duration-150">
              Tích hợp
            </a>
            <a href="#security" className="hover:text-[#09090B] transition-colors duration-150">
              Bảo mật
            </a>
          </nav>

          <button
            type="button"
            onClick={() => {
              switchMode('register');
              document.getElementById('auth-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="cm-btn cm-btn-primary"
          >
            Bắt đầu sử dụng
          </button>
        </div>
      </header>

      <main id="top" className="cm-studio-surface">
        <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-10 pb-16 lg:pt-14 lg:pb-24">
          <div className="grid gap-10 lg:grid-cols-12 items-start">
            <div className="lg:col-span-5 space-y-6 comey-enter">
              <div className="space-y-4">
                <h1 className="text-[32px] sm:text-[38px] font-semibold tracking-[-0.03em] leading-[1.12] text-[#09090B]">
                  Đối soát chuyển khoản trực tiếp từ email ngân hàng.
                </h1>
                <p className="text-[15px] text-[#52525B] leading-relaxed">
                  Phân tích biến động số dư từ Cake, MB, Vietcombank, Techcombank, Timo và ACB.
                  Xác thực chữ ký DKIM và gửi thông báo tới Webhook, Telegram, Google Sheets hoặc
                  Loa thu ngân không giới hạn giao dịch.
                </p>

                <div className="flex items-center gap-5 pt-1">
                  <div>
                    <div className="font-mono-num text-[15px] font-semibold text-[#09090B]">0đ</div>
                    <div className="text-[12px] text-[#71717A]">Phí giao dịch</div>
                  </div>
                  <div className="w-px h-7 bg-black/[0.08]" aria-hidden="true" />
                  <div>
                    <div className="font-mono-num text-[15px] font-semibold text-[#09090B]">6</div>
                    <div className="text-[12px] text-[#71717A]">Ngân hàng hỗ trợ</div>
                  </div>
                  <div className="w-px h-7 bg-black/[0.08]" aria-hidden="true" />
                  <div>
                    <div className="font-mono-num text-[15px] font-semibold text-[#047857]">
                      1–3 giây
                    </div>
                    <div className="text-[12px] text-[#71717A]">Thời gian phản hồi</div>
                  </div>
                </div>
              </div>

              <div id="auth-panel" className="cm-panel p-6 space-y-5">
                <SegmentedControl
                  value={mode}
                  onChange={switchMode}
                  ariaLabel="Chọn hình thức xác thực"
                  fullWidth
                  options={[
                    { value: 'login', label: 'Đăng nhập' },
                    { value: 'register', label: 'Tạo tài khoản' },
                  ]}
                />

                <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
                  {mode === 'register' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="auth-name"
                          className="block text-[12.5px] font-medium text-[#09090B] mb-1"
                        >
                          Tên hiển thị
                        </label>
                        <input
                          id="auth-name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Minh Tân"
                          className="cm-input"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="auth-ws"
                          className="block text-[12.5px] font-medium text-[#09090B] mb-1"
                        >
                          Tên Workspace
                        </label>
                        <input
                          id="auth-ws"
                          type="text"
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          placeholder="Cửa hàng trực tuyến"
                          className="cm-input"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="auth-email"
                      className="block text-[12.5px] font-medium text-[#09090B] mb-1"
                    >
                      Địa chỉ email
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="owner@domain.com"
                      className="cm-input"
                    />
                    {fieldErrors.email && (
                      <p className="mt-1 text-[12px] font-medium text-[#DC2626]">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="auth-password"
                      className="block text-[12.5px] font-medium text-[#09090B] mb-1"
                    >
                      Mật khẩu
                    </label>
                    <div className="relative">
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Ít nhất 8 ký tự gồm chữ và số"
                        className="cm-input pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        className="absolute right-0.5 top-0.5 h-9 w-9 rounded-[6px] flex items-center justify-center text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5] cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {mode === 'register' && password.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="grid grid-cols-3 gap-1.5">
                          {[1, 2, 3].map((step) => (
                            <div
                              key={step}
                              className={`h-1 rounded-full ${
                                pwStrength.score >= step ? pwStrength.color : 'bg-zinc-200'
                              }`}
                            />
                          ))}
                        </div>
                        <div className="text-[11.5px] text-[#52525B]">
                          Độ mạnh: <span className="font-medium text-[#09090B]">{pwStrength.label}</span>
                        </div>
                      </div>
                    )}
                    {fieldErrors.password && (
                      <p className="mt-1 text-[12px] font-medium text-[#DC2626]">
                        {fieldErrors.password}
                      </p>
                    )}
                  </div>

                  {formError && (
                    <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
                      {formError}
                    </div>
                  )}

                  <button type="submit" disabled={loading} className="cm-btn cm-btn-primary w-full h-10">
                    {loading
                      ? 'Đang xác thực...'
                      : mode === 'login'
                        ? 'Đăng nhập Workspace'
                        : 'Tạo Workspace mới'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>

            <div id="pipeline" className="lg:col-span-7 min-w-0 comey-enter-delay-1">
              <div className="cm-panel overflow-hidden">
                <div className="px-5 py-3 bg-[#FAFAFA] border-b border-black/[0.08] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#09090B]">
                    <span className="w-2 h-2 rounded-full bg-[#047857] cm-live-dot" />
                    Luồng xử lý thời gian thực
                  </div>
                  <SegmentedControl
                    size="sm"
                    value={simScenario}
                    onChange={setSimScenario}
                    ariaLabel="Chọn kịch bản mô phỏng"
                    options={[
                      { value: 'verified', label: 'Xác thực DKIM' },
                      { value: 'spoof', label: 'Chặn giả mạo' },
                      { value: 'nocode', label: 'Kênh 0đ & POS' },
                    ]}
                  />
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                  <div className="grid gap-3.5 md:grid-cols-[1fr_0.9fr_1.2fr] items-center">
                    <div className="min-w-0 rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <BrandIcon id="gmail" size={16} tile />
                          <span className="text-[12.5px] font-semibold text-[#09090B] truncate">
                            Email đầu vào
                          </span>
                        </div>
                        <Mail className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                      </div>
                      <div className="font-mono-num text-[12px] font-medium text-[#09090B] truncate">
                        {simScenario === 'spoof'
                          ? 'alert@fake-bank.example'
                          : simScenario === 'nocode'
                            ? 'thongbao@mbbank.com.vn'
                            : 'no-reply@cake.vn'}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <IdentityAvatar
                            seed={simScenario === 'nocode' ? 'TRAN MINH TAN' : 'NGUYEN MINH AN'}
                            size="xs"
                          />
                          <BankEmblem
                            code={simScenario === 'nocode' ? 'MB' : 'CAKE'}
                            size="sm"
                          />
                        </div>
                        <div className="font-mono-num text-[12px] font-semibold text-[#047857] shrink-0">
                          {simScenario === 'nocode' ? '+125.000 đ' : '+80.000 đ'}
                        </div>
                      </div>
                      <span
                        className={`inline-block max-w-full truncate rounded-[5px] px-2 py-0.5 text-[11px] font-mono-num font-medium ${
                          simScenario === 'spoof'
                            ? 'bg-rose-50 text-[#DC2626] border border-rose-200/80'
                            : 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
                        }`}
                      >
                        {simScenario === 'spoof'
                          ? 'header.d=fake-bank (fail)'
                          : simScenario === 'nocode'
                            ? 'dkim=pass (mbbank.com.vn)'
                            : 'dkim=pass (cake.vn)'}
                      </span>
                    </div>

                    <div className="relative min-w-0 flex flex-col items-center justify-center">
                      <svg
                        className="hidden md:block w-full h-5 mb-1.5"
                        viewBox="0 0 120 20"
                        aria-hidden="true"
                      >
                        <line
                          x1="0"
                          y1="10"
                          x2="120"
                          y2="10"
                          stroke={simScenario === 'spoof' ? '#DC2626' : '#047857'}
                          strokeWidth="1.5"
                          className="comey-signal-line"
                        />
                      </svg>
                      <div
                        className={`w-full rounded-[8px] border p-3.5 text-center space-y-1.5 ${
                          simScenario === 'spoof'
                            ? 'border-rose-200 bg-rose-50/70'
                            : 'border-[#A7F3D0] bg-[#ECFDF5]/60'
                        }`}
                      >
                        {simScenario === 'spoof' ? (
                          <ShieldAlert className="w-4 h-4 text-[#DC2626] mx-auto" />
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <BrandIcon id="cloudflare-workers" size={16} tile />
                            <ShieldCheck className="w-4 h-4 text-[#047857]" />
                          </div>
                        )}
                        <div className="text-[12.5px] font-semibold text-[#09090B]">
                          {simScenario === 'spoof'
                            ? 'Kiểm duyệt domain'
                            : 'Xác thực DKIM & Parser'}
                        </div>
                        <div className="text-[11.5px] text-[#52525B]">
                          {simScenario === 'spoof'
                            ? 'Từ chối chữ ký sai domain'
                            : 'Xóa email gốc ngay sau parse'}
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-2">
                      {simScenario === 'verified' && (
                        <>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ChannelBadgeIcon format="comey" size={16} />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold truncate">
                                  HMAC Webhook
                                </div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  X-Comey-Signature
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#09090B] text-white px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              200 OK
                            </span>
                          </div>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BankEmblem code="CAKE" size="sm" />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold truncate">Checkout</div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  SHOP100200
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              PAID
                            </span>
                          </div>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BrandIcon id="sqlite" size={18} tile />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold truncate">
                                  Query API
                                </div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  /v1/transactions
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#F4F4F5] text-[#52525B] px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              READY
                            </span>
                          </div>
                        </>
                      )}

                      {simScenario === 'nocode' && (
                        <>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BrandIcon id="telegram" size={16} tile />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold truncate">
                                  Telegram Bot
                                </div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  Mã hóa AES-GCM
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              ĐÃ GỬI
                            </span>
                          </div>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BrandIcon id="google-sheets" size={16} tile />
                              <div className="min-w-0">
                                <div className="text-[12.5px] font-semibold truncate">
                                  Google Sheets
                                </div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  Tự động ghi dòng
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#09090B] text-white px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              200 OK
                            </span>
                          </div>
                          <div className="rounded-[8px] border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BrandIcon id="discord" size={16} tile />
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold truncate flex items-center gap-1.5">
                                  <span>Discord &amp; Loa POS</span>
                                  <span className="cm-eq-bars" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#71717A] font-mono-num truncate">
                                  Chuyển xanh tự động
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-[5px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 text-[10.5px] font-mono-num font-medium">
                              ĐÃ ĐỌC
                            </span>
                          </div>
                        </>
                      )}

                      {simScenario === 'spoof' && (
                        <div className="rounded-[8px] border border-rose-200 bg-rose-50/80 p-4 space-y-1.5">
                          <div className="text-[13px] font-semibold text-[#DC2626]">
                            Chuyển vào Hộp cách ly 72 giờ
                          </div>
                          <p className="text-[12.5px] text-[#52525B] leading-relaxed">
                            Không có webhook nào được gửi đi. Trạng thái phiên thanh toán giữ nguyên
                            để bảo vệ tài khoản.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[8px] bg-[#09090B] text-zinc-200 p-4 text-[12px] font-mono-num overflow-x-auto leading-relaxed">
                    <div className="text-[#34D399] mb-1">
                      {simScenario === 'verified' &&
                        '// Event: session.paid | đã đối soát tự động'}
                      {simScenario === 'nocode' &&
                        '// Multi-Channel Dispatch | không cần máy chủ trung gian'}
                      {simScenario === 'spoof' &&
                        '// Audit Event: email.quarantined | spoof_suspected'}
                    </div>
                    {simScenario === 'verified' &&
                      `{ "type": "session.paid", "orderCode": "SHOP100200", "amount": 80000, "dkim": "cake.vn" }`}
                    {simScenario === 'nocode' &&
                      `{ "bankCode": "MB", "amount": 125000, "channels": ["telegram", "google_sheets", "soundbox_pos"] }`}
                    {simScenario === 'spoof' &&
                      `{ "status": "quarantined", "reason": "DKIM alignment mismatch for expected bank domain" }`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="integrations" className="border-t border-black/[0.08] bg-white py-16">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 space-y-9">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
                Hệ sinh thái kết nối đồng bộ
              </h2>
              <p className="text-[14.5px] text-[#52525B] leading-relaxed">
                Thu thập thông báo biến động từ 12 ngân hàng Việt Nam qua Gmail Routing và phân phối
                tới nhóm chat, bảng tính, Loa POS hoặc mã nguồn riêng trên một kết nối duy nhất.
              </p>
            </div>

            <div className="cm-panel cm-studio-surface p-5 sm:p-6 bg-[#F5F6F7]">
              <div className="grid gap-4 lg:grid-cols-[1.12fr_28px_0.98fr_28px_1.38fr] items-center">
                {/* Left: 12 Real Vietnamese Bank Logos */}
                <div className="rounded-[10px] border border-black/[0.08] bg-white p-4 space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[#09090B]">
                      12 Ngân hàng hỗ trợ
                    </span>
                    <span className="font-mono-num text-[11px] text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 rounded-[5px]">
                      VietQR EMVCo
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {BANK_CODES_ALL.map((code) => (
                      <div
                        key={code}
                        className="rounded-[8px] border border-black/[0.06] bg-[#F5F6F7] p-1.5 flex items-center justify-center min-w-0"
                      >
                        <BankLogo code={code} size="card" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connector 1 */}
                <div className="hidden lg:flex items-center justify-center" aria-hidden="true">
                  <svg viewBox="0 0 56 24" className="w-14 h-6">
                    <line
                      x1="2"
                      y1="12"
                      x2="54"
                      y2="12"
                      stroke="#047857"
                      strokeWidth="1.5"
                      className="comey-signal-line"
                    />
                  </svg>
                </div>

                {/* Center: Comey Edge Core */}
                <div className="rounded-[10px] border border-[#09090B] bg-[#09090B] text-white p-4 space-y-3.5 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <ComeyMark size={28} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold leading-tight">
                        Comey Edge Core
                      </div>
                      <div className="text-[11.5px] text-zinc-400">DKIM + Idempotent Engine</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-[8px] bg-white/10 border border-white/10 px-1.5 py-2 flex flex-col items-center gap-1.5 text-center">
                      <BrandIcon id="gmail" size={18} tile onDark />
                      <span className="text-[10.5px] text-zinc-200 whitespace-nowrap">Gmail</span>
                    </div>
                    <div className="rounded-[8px] bg-white/10 border border-white/10 px-1.5 py-2 flex flex-col items-center gap-1.5 text-center">
                      <BrandIcon id="cloudflare-workers" size={18} tile onDark />
                      <span className="text-[10.5px] text-zinc-200 whitespace-nowrap">Workers</span>
                    </div>
                    <div className="rounded-[8px] bg-white/10 border border-white/10 px-1.5 py-2 flex flex-col items-center gap-1.5 text-center">
                      <BrandIcon id="sqlite" size={18} tile onDark />
                      <span className="text-[10.5px] text-zinc-200 whitespace-nowrap">D1 SQLite</span>
                    </div>
                  </div>
                </div>

                {/* Connector 2 */}
                <div className="hidden lg:flex items-center justify-center" aria-hidden="true">
                  <svg viewBox="0 0 56 24" className="w-10 h-6">
                    <line
                      x1="2"
                      y1="12"
                      x2="54"
                      y2="12"
                      stroke="#047857"
                      strokeWidth="1.5"
                      className="comey-signal-line"
                    />
                  </svg>
                </div>

                {/* Right: No-code & SDK Targets */}
                <div className="rounded-[10px] border border-black/[0.08] bg-white p-4 space-y-3 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#09090B]">
                      Đầu ra tức thì &amp; SDK
                    </span>
                    <span className="font-mono-num text-[11px] text-[#52525B]">OpenAPI 3.1</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'telegram' as const, label: 'Telegram' },
                      { id: 'discord' as const, label: 'Discord' },
                      { id: 'google-sheets' as const, label: 'Sheets' },
                      { id: 'nodejs' as const, label: 'Node.js' },
                      { id: 'typescript' as const, label: 'TypeScript' },
                      { id: 'python' as const, label: 'Python' },
                      { id: 'php' as const, label: 'PHP' },
                      { id: 'arduino' as const, label: 'ESP32' },
                      { id: 'postman' as const, label: 'Postman' },
                    ].map((tool) => (
                      <div
                        key={tool.id}
                        className="rounded-[7px] border border-black/[0.06] bg-[#FAFAFA] px-1.5 py-1.5 flex items-center gap-1.5 min-w-0"
                      >
                        <BrandIcon id={tool.id} size={14} tile />
                        <span className="text-[11px] font-medium text-[#09090B] truncate">
                          {tool.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="border-t border-black/[0.08] bg-[#FAFAFA] py-16">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 space-y-10">
            <div className="max-w-xl space-y-2">
              <h2 className="text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
                Quy trình triển khai 4 bước
              </h2>
              <p className="text-[14.5px] text-[#52525B] leading-relaxed">
                Từ lúc khởi tạo tài khoản đến khi nhận sự kiện đối soát đầu tiên trong vài phút,
                không cần cấp mật khẩu ngân hàng hay đọc toàn bộ hộp thư cá nhân.
              </p>
            </div>

            <div className="cm-panel grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.08]">
              {[
                {
                  step: '01',
                  icon: PhQrCode,
                  title: 'Khai báo tài khoản & VietQR',
                  desc: 'Chọn ngân hàng nhận tiền (Cake, MB, VCB, Techcombank, Timo, ACB) và khởi tạo mã VietQR chuẩn EMVCo.',
                },
                {
                  step: '02',
                  icon: EnvelopeSimple,
                  title: 'Kết nối chuyển tiếp Email',
                  desc: 'Thiết lập bộ lọc Gmail tự động chuyển tiếp thư biến động số dư hoặc cầu nối Apps Script trực tiếp.',
                },
                {
                  step: '03',
                  icon: ShareNetwork,
                  title: 'Định tuyến đa kênh',
                  desc: 'Chia luồng từ một tài khoản tới Webhook HMAC, SePay/PayOS Drop-in, Telegram Bot, Discord hoặc Google Sheets.',
                },
                {
                  step: '04',
                  icon: PhCheckCircle,
                  title: 'Kiểm thử toàn trình',
                  desc: 'Dùng trình mô phỏng kiểm tra parser, đối soát đơn và phản hồi âm thanh trên Loa Kiosk trước khi vận hành.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.step} className="p-6 space-y-3 bg-white">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-num text-[12px] font-semibold text-[#047857]">
                        BƯỚC {item.step}
                      </span>
                      <span className="cm-kpi-badge">
                        <Icon size={16} weight="duotone" className="text-[#09090B]" />
                      </span>
                    </div>
                    <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-[#09090B]">
                      {item.title}
                    </h3>
                    <p className="text-[13.5px] text-[#52525B] leading-relaxed">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="security" className="border-t border-black/[0.08] bg-white py-16">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 space-y-10">
            <div className="max-w-xl space-y-2">
              <h2 className="text-[24px] font-semibold tracking-[-0.025em] text-[#09090B]">
                Kiến trúc bảo mật nhiều tầng
              </h2>
              <p className="text-[14.5px] text-[#52525B] leading-relaxed">
                Hệ thống không lưu giữ tiền hộ và không lưu trữ nội dung email gốc sau khi hoàn tất
                bóc tách giao dịch.
              </p>
            </div>

            <div className="cm-panel grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-black/[0.08]">
              <div className="divide-y divide-black/[0.08]">
                <div className="p-6 flex items-start gap-4">
                  <span className="cm-kpi-badge cm-kpi-badge-emerald w-9 h-9">
                    <PhShieldCheck size={18} weight="duotone" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-[14.5px] font-semibold text-[#09090B]">
                      Xác thực DKIM &amp; ARC Alignment
                    </h3>
                    <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                      Kiểm tra khớp tên miền ký DKIM với ngân hàng phát hành hoặc chuỗi ARC khi
                      auto-forward. Thư không đạt bị cách ly tự động.
                    </p>
                  </div>
                </div>
                <div className="p-6 flex items-start gap-4">
                  <span className="cm-kpi-badge cm-kpi-badge-emerald w-9 h-9">
                    <Fingerprint size={18} weight="duotone" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-[14.5px] font-semibold text-[#09090B]">
                      Chống trùng lặp cấp cơ sở dữ liệu
                    </h3>
                    <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                      Khóa duy nhất theo mã giao dịch ngân hàng ngăn chặn cộng tiền hai lần ngay cả
                      khi nhận cùng một thông báo nhiều lượt.
                    </p>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-black/[0.08]">
                <div className="p-6 flex items-start gap-4">
                  <span className="cm-kpi-badge cm-kpi-badge-emerald w-9 h-9">
                    <LockKey size={18} weight="duotone" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-[14.5px] font-semibold text-[#09090B]">
                      Cô lập SSRF, Redirect &amp; ReDoS
                    </h3>
                    <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                      Chặn dải IP nội bộ, IPv6 private, chặn chuyển hướng tùy ý khi gửi webhook và
                      giới hạn an toàn biểu thức chính quy.
                    </p>
                  </div>
                </div>
                <div className="p-6 flex items-start gap-4">
                  <span className="cm-kpi-badge cm-kpi-badge-emerald w-9 h-9">
                    <PhKey size={18} weight="duotone" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-[14.5px] font-semibold text-[#09090B]">
                      Mã hóa AES-256-GCM &amp; RBAC
                    </h3>
                    <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                      Mọi khóa bí mật Webhook, Bot Token Telegram và API Key được mã hóa hoặc băm
                      một chiều, đi kèm giới hạn RPM và IP Allowlist.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.08] bg-[#FAFAFA] py-8">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 text-[13px] text-[#71717A]">
            <div className="flex items-center gap-2.5 font-semibold text-[#09090B]">
              <ComeyMark size={22} />
              <span>Comey Open-Core Payment Bridge</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <BrandIcon id="cloudflare-workers" size={14} /> Cloudflare Workers
              </span>
              <span className="w-px h-3.5 bg-black/[0.1]" aria-hidden="true" />
              <span className="inline-flex items-center gap-1.5">
                <BrandIcon id="sqlite" size={14} /> D1 SQLite
              </span>
              <span className="w-px h-3.5 bg-black/[0.1]" aria-hidden="true" />
              <span className="inline-flex items-center gap-1.5">
                <BrandIcon id="gmail" size={14} /> Gmail Routing
              </span>
            </div>
          </div>
          <p className="text-[11.5px] text-[#71717A]">
            Tên sản phẩm và biểu trưng thuộc quyền sở hữu của các đơn vị tương ứng.
          </p>
        </div>
      </footer>
    </div>
  );
}
