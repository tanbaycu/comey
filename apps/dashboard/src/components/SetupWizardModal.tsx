import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Mail,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { copyToClipboard } from '../lib/format';
import type { BankAccount, SimulationResponse } from '../lib/types';
import { Badge, statusTone } from './Badge';
import { BankLogo, getBankMeta } from './BankEmblem';
import { SegmentedControl } from './SegmentedControl';

const STEPS = [
  { id: 1, title: 'Tài khoản & DKIM' },
  { id: 2, title: 'Kết nối Email' },
  { id: 3, title: 'Định tuyến Webhook' },
  { id: 4, title: 'Kiểm thử luồng' },
] as const;

export function SetupWizardModal({
  account,
  onClose,
  onRefreshAll,
  onReloadRules,
  onReloadAfterSim,
  onNotify,
}: {
  account: BankAccount;
  onClose: () => void;
  onRefreshAll: () => Promise<void>;
  onReloadRules?: () => Promise<void>;
  onReloadAfterSim?: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [strictAuth, setStrictAuth] = useState(account.strictAuth);
  const [savingStep1, setSavingStep1] = useState(false);

  const [channelTab, setChannelTab] = useState<'forward' | 'apps_script'>('forward');
  const [scriptMode, setScriptMode] = useState<'cloud_bridge' | 'standalone'>('cloud_bridge');
  const [customWebhookUrl, setCustomWebhookUrl] = useState('');
  const [scriptCode, setScriptCode] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [loadingScript, setLoadingScript] = useState(false);
  const [rotatedToken, setRotatedToken] = useState('');
  const [appsScriptUrl, setAppsScriptUrl] = useState(account.appsScriptUrl || '');
  const [appsScriptSecret, setAppsScriptSecret] = useState('');
  const [savingOnDemand, setSavingOnDemand] = useState(false);

  const [rulePrefix, setRulePrefix] = useState('SHOP');
  const [ruleWebhookUrl, setRuleWebhookUrl] = useState('');
  const [createdRuleSecret, setCreatedRuleSecret] = useState('');
  const [creatingRule, setCreatingRule] = useState(false);
  const [step3Error, setStep3Error] = useState('');

  const [simAmount, setSimAmount] = useState(80000);
  const [simContent, setSimContent] = useState('SHOP100200');
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResponse['simulation'] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function loadScript(mode: 'cloud_bridge' | 'standalone') {
    setLoadingScript(true);
    try {
      const res = await api.bankAccounts.getAppsScript(
        account.id,
        mode,
        mode === 'standalone' ? customWebhookUrl.trim() || undefined : undefined
      );
      setScriptCode(res.code);
      setIngestUrl(res.ingestUrl);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không tải được mã Apps Script');
    } finally {
      setLoadingScript(false);
    }
  }

  useEffect(() => {
    if (step === 2 && channelTab === 'apps_script') {
      void loadScript(scriptMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, channelTab, scriptMode]);

  async function handleCopy(val: string, keyId: string, label: string) {
    const ok = await copyToClipboard(val);
    if (ok) {
      setCopiedKey(keyId);
      window.setTimeout(() => setCopiedKey((prev) => (prev === keyId ? null : prev)), 1600);
      onNotify('success', `Đã sao chép ${label}`);
    } else {
      onNotify('error', 'Không thể sao chép vào clipboard');
    }
  }

  async function handleSaveStep1AndNext() {
    if (strictAuth !== account.strictAuth) {
      setSavingStep1(true);
      try {
        await api.bankAccounts.update(account.id, { strictAuth });
        await onRefreshAll();
      } catch (err) {
        onNotify('error', err instanceof ApiError ? err.message : 'Lỗi cập nhật cấu hình');
        setSavingStep1(false);
        return;
      } finally {
        setSavingStep1(false);
      }
    }
    setStep(2);
  }

  async function handleRotateToken() {
    try {
      const res = await api.bankAccounts.rotateAppsScriptToken(account.id);
      setRotatedToken(res.appsScriptToken);
      onNotify('success', 'Đã cấp token mới cho Apps Script');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi cấp token');
    }
  }

  async function handleSaveOnDemand(e: React.FormEvent) {
    e.preventDefault();
    setSavingOnDemand(true);
    try {
      await api.bankAccounts.update(account.id, {
        appsScriptUrl: appsScriptUrl.trim() || null,
        appsScriptSecret: appsScriptSecret.trim() || undefined,
      });
      await onRefreshAll();
      onNotify('success', 'Đã lưu cấu hình quét tức thì On-Demand');
      setAppsScriptSecret('');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi lưu URL On-Demand');
    } finally {
      setSavingOnDemand(false);
    }
  }

  async function handleConfirmForwarding() {
    try {
      await api.bankAccounts.confirmForwarding(account.id);
      await onRefreshAll();
      onNotify('success', 'Đã xác nhận kênh Auto-Forward sẵn sàng');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể xác nhận');
    }
  }

  async function handleCreateQuickRule(e: React.FormEvent) {
    e.preventDefault();
    setStep3Error('');
    setCreatingRule(true);
    try {
      const cleanPrefix = rulePrefix.trim().toUpperCase() || 'SHOP';
      const res = await api.routingRules.create({
        bankAccountId: account.id,
        name: `Luật ${cleanPrefix}`,
        matchType: 'prefix',
        pattern: cleanPrefix,
        priority: 10,
        webhookUrl: ruleWebhookUrl.trim(),
      });
      setCreatedRuleSecret(res.webhookSecret);
      setSimContent(`${cleanPrefix}100200`);
      await (onReloadRules ? onReloadRules() : onRefreshAll());
      onNotify('success', 'Đã tạo luật định tuyến Webhook');
    } catch (err) {
      setStep3Error(err instanceof ApiError ? err.message : 'Không thể tạo luật định tuyến');
    } finally {
      setCreatingRule(false);
    }
  }

  async function handleRunVerificationSim() {
    setSimRunning(true);
    try {
      const res = await api.simulator.transfer({
        bankAccountId: account.id,
        amount: simAmount,
        content: simContent,
        senderName: 'WIZARD VERIFIER',
      });
      setSimResult(res.simulation);
      await (onReloadAfterSim ? onReloadAfterSim() : onRefreshAll());
      onNotify('success', 'Kiểm thử luồng end-to-end hoàn tất');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi chạy kiểm thử');
    } finally {
      setSimRunning(false);
    }
  }

  function handleDownloadScript() {
    const blob = new Blob([scriptCode], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comey-${account.bankCode.toLowerCase()}-${account.accountNumber}.gs`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[12px] border border-black/[0.08] w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="px-6 py-4 border-b border-black/[0.08] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="wizard-title"
                className="text-[15px] font-semibold tracking-[-0.02em] text-[#09090B]"
              >
                Thiết lập kết nối {account.bankCode} ({account.accountNumber})
              </h3>
              <Badge tone={statusTone(account.forwardingStatus)}>
                {account.forwardingStatus}
              </Badge>
            </div>
            <p className="text-[12.5px] text-[#71717A] mt-0.5">
              Hoàn tất các bước để xác thực kênh email và kiểm tra webhook trước khi vận hành.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thiết lập"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[7px] hover:bg-[#F4F4F5] text-[#71717A] hover:text-[#09090B] cursor-pointer shrink-0 transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-3 bg-[#FAFAFA] border-b border-black/[0.08] grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STEPS.map((s) => {
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(s.id)}
                className={`min-h-[38px] flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] font-medium border transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#09090B] text-white border-[#09090B]'
                    : isDone
                      ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                      : 'bg-white text-[#52525B] border-black/[0.08] hover:text-[#09090B]'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-[5px] text-[11px] flex items-center justify-center font-mono-num font-semibold shrink-0 ${
                    isActive
                      ? 'bg-[#10B981] text-white'
                      : isDone
                        ? 'bg-[#047857] text-white'
                        : 'bg-[#F4F4F5] text-[#52525B]'
                  }`}
                >
                  {isDone ? '✓' : s.id}
                </span>
                <span className="leading-tight truncate">{s.title}</span>
              </button>
            );
          })}
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-[13.5px] flex-1">
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-[10px] bg-[#FAFAFA] border border-black/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <BankLogo code={account.bankCode} size="xs" />
                    <span className="text-[12.5px] font-semibold text-[#09090B]">
                      {getBankMeta(account.bankCode).name}
                    </span>
                  </div>
                  <div className="mt-1 font-mono-num text-[22px] font-semibold tracking-[-0.02em] text-[#09090B]">
                    {account.accountNumber}
                  </div>
                  <div className="text-[12.5px] text-[#52525B] uppercase mt-0.5">
                    {account.accountName}
                  </div>
                </div>
                <Badge tone="green">Sẵn sàng VietQR EMVCo</Badge>
              </div>

              <label
                htmlFor="wiz-strict-auth"
                className="flex items-start gap-3 rounded-[10px] border border-black/[0.08] p-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors duration-150"
              >
                <input
                  id="wiz-strict-auth"
                  type="checkbox"
                  checked={strictAuth}
                  onChange={(e) => setStrictAuth(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded accent-[#047857]"
                />
                <div>
                  <div className="text-[13.5px] font-semibold text-[#09090B] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#047857]" />
                    Kiểm duyệt nghiêm ngặt DKIM Anti-Spoofing
                  </div>
                  <p className="text-[12.5px] text-[#52525B] mt-1 leading-relaxed">
                    Yêu cầu email phải vượt qua DKIM=pass khớp tên miền ngân hàng. Email nghi ngờ
                    giả mạo sẽ được đưa vào Hộp cách ly 72 giờ.
                  </p>
                </div>
              </label>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={savingStep1}
                  onClick={() => void handleSaveStep1AndNext()}
                  className="cm-btn cm-btn-primary"
                >
                  {savingStep1 ? 'Đang lưu...' : 'Tiếp tục bước 2'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 border-b border-black/[0.08] pb-3">
                <button
                  type="button"
                  onClick={() => setChannelTab('forward')}
                  className={`cm-btn ${
                    channelTab === 'forward' ? 'cm-btn-primary' : 'cm-btn-secondary'
                  }`}
                >
                  <Mail className="w-4 h-4" /> Auto-Forward Gmail
                </button>
                <button
                  type="button"
                  onClick={() => setChannelTab('apps_script')}
                  className={`cm-btn ${
                    channelTab === 'apps_script' ? 'cm-btn-primary' : 'cm-btn-secondary'
                  }`}
                >
                  <Terminal className="w-4 h-4" /> Google Apps Script
                </button>
              </div>

              {channelTab === 'forward' ? (
                <div className="space-y-4">
                  <div className="rounded-[10px] bg-[#FAFAFA] border border-black/[0.08] p-4 space-y-2">
                    <div className="text-[12px] font-medium text-[#71717A]">
                      Địa chỉ tiếp nhận riêng của tài khoản
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[8px] bg-white border border-black/[0.08] px-3.5 py-2.5">
                      <code className="font-mono-num text-[13px] font-medium text-[#09090B] break-all">
                        {account.inboundEmail}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopy(account.inboundEmail, 'inbound', 'Inbound Email')
                        }
                        className="cm-btn cm-btn-primary h-8 px-3 text-[12px] shrink-0"
                      >
                        {copiedKey === 'inbound' ? (
                          <Check className="w-3.5 h-3.5 text-[#34D399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedKey === 'inbound' ? 'Đã sao chép' : 'Sao chép'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[10px] border border-black/[0.08] p-4 space-y-2 text-[12.5px] text-[#52525B]">
                    <div className="font-semibold text-[#09090B]">Hướng dẫn cấu hình Gmail</div>
                    <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                      <li>
                        Mở Gmail, vào Cài đặt, chọn Chuyển tiếp và thêm địa chỉ{' '}
                        <code className="font-mono-num bg-[#F4F4F5] px-1.5 py-0.5 rounded-[4px] text-[#09090B]">
                          {account.inboundEmail}
                        </code>
                      </li>
                      <li>
                        Tạo bộ lọc Filter cho thư từ ngân hàng (ví dụ cake.vn, mbbank.com.vn,
                        vietcombank.com.vn) chuyển tiếp tới địa chỉ trên.
                      </li>
                    </ol>
                  </div>

                  <div className="rounded-[10px] border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-amber-900">
                        Mã xác nhận Google Forwarding
                      </span>
                      <button
                        type="button"
                        onClick={() => void onRefreshAll()}
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-amber-900 hover:underline cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Kiểm tra lại
                      </button>
                    </div>

                    {account.forwardingConfirmCode || account.forwardingConfirmUrl ? (
                      <div className="rounded-[8px] bg-white border border-amber-200 p-3 space-y-2">
                        {account.forwardingConfirmCode && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12.5px] text-[#52525B]">Mã xác nhận:</span>
                            <div className="flex items-center gap-2">
                              <code className="font-mono-num text-[13.5px] font-semibold text-[#09090B]">
                                {account.forwardingConfirmCode}
                              </code>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopy(
                                    account.forwardingConfirmCode!,
                                    'fwd_code',
                                    'mã xác nhận'
                                  )
                                }
                                className="text-[12.5px] font-semibold text-[#047857] underline cursor-pointer"
                              >
                                {copiedKey === 'fwd_code' ? 'Đã chép' : 'Sao chép'}
                              </button>
                            </div>
                          </div>
                        )}
                        {account.forwardingConfirmUrl && (
                          <a
                            href={account.forwardingConfirmUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="cm-btn cm-btn-primary h-8 text-[12px]"
                          >
                            Mở liên kết xác nhận <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-amber-800 leading-relaxed">
                        Chưa ghi nhận email xác nhận từ Google. Nếu đang kiểm thử cục bộ hoặc đã
                        xác nhận thủ công, bạn có thể nhấn xác nhận bên dưới.
                      </p>
                    )}

                    {account.forwardingStatus !== 'verified' && (
                      <button
                        type="button"
                        onClick={() => void handleConfirmForwarding()}
                        className="cm-btn cm-btn-emerald h-8 text-[12.5px]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Xác nhận đã bật Forward
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <SegmentedControl
                      size="sm"
                      value={scriptMode}
                      onChange={setScriptMode}
                      ariaLabel="Chế độ Apps Script"
                      options={[
                        { value: 'cloud_bridge', label: 'Cloud Bridge' },
                        { value: 'standalone', label: 'Standalone' },
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => void handleRotateToken()}
                      className="cm-btn cm-btn-secondary h-8 text-[12px]"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Cấp lại Secret Bridge
                    </button>
                  </div>

                  {scriptMode === 'standalone' && (
                    <div className="flex gap-2">
                      <input
                        id="wiz-standalone-webhook"
                        type="url"
                        aria-label="Webhook URL cho chế độ Standalone"
                        value={customWebhookUrl}
                        onChange={(e) => setCustomWebhookUrl(e.target.value)}
                        placeholder="https://bot-cua-ban.example.com/webhook"
                        className="cm-input flex-1 font-mono-num"
                      />
                      <button
                        type="button"
                        onClick={() => void loadScript('standalone')}
                        className="cm-btn cm-btn-primary shrink-0"
                      >
                        Tạo lại mã
                      </button>
                    </div>
                  )}

                  {rotatedToken && (
                    <div className="rounded-[8px] bg-[#ECFDF5] border border-[#A7F3D0] p-3 flex items-center justify-between gap-3">
                      <div className="text-[12.5px] text-[#047857] min-w-0">
                        <div className="font-semibold">COMEY_INGEST_SECRET mới</div>
                        <code className="font-mono-num font-semibold break-all text-[#09090B]">
                          {rotatedToken}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(rotatedToken, 'as_tok', 'Apps Script Token')}
                        className="cm-btn cm-btn-primary h-8 px-3 text-[12px]"
                      >
                        {copiedKey === 'as_tok' ? 'Đã chép' : 'Sao chép'}
                      </button>
                    </div>
                  )}

                  <div className="rounded-[10px] border border-black/[0.08] overflow-hidden">
                    <div className="bg-[#09090B] text-zinc-200 px-4 py-2.5 flex items-center justify-between text-[12px] gap-2">
                      <span className="font-mono-num truncate">Ingest: {ingestUrl}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleCopy(scriptCode, 'gs_code', 'Code.gs')}
                          className="rounded-[6px] bg-white/10 hover:bg-white/20 px-2.5 py-1 font-medium cursor-pointer inline-flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedKey === 'gs_code' ? 'Đã chép' : 'Sao chép'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadScript}
                          className="rounded-[6px] bg-[#047857] hover:bg-[#065F46] text-white px-2.5 py-1 font-medium cursor-pointer inline-flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" /> Tải .gs
                        </button>
                      </div>
                    </div>
                    <pre className="p-4 bg-[#18181B] text-zinc-100 text-[12px] font-mono-num overflow-x-auto max-h-52 leading-relaxed">
                      {loadingScript ? 'Đang tạo mã Apps Script...' : scriptCode}
                    </pre>
                  </div>

                  <form
                    onSubmit={handleSaveOnDemand}
                    className="rounded-[10px] bg-[#FAFAFA] border border-black/[0.08] p-4 space-y-3"
                  >
                    <div className="text-[12.5px] font-semibold text-[#09090B]">
                      Liên kết Web App On-Demand (tùy chọn)
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        id="wiz-apps-script-url"
                        type="url"
                        aria-label="URL Web App Apps Script"
                        value={appsScriptUrl}
                        onChange={(e) => setAppsScriptUrl(e.target.value)}
                        placeholder="https://script.google.com/macros/s/.../exec"
                        className="cm-input font-mono-num"
                      />
                      <input
                        id="wiz-apps-script-secret"
                        type="password"
                        aria-label="COMEY_INGEST_SECRET"
                        value={appsScriptSecret}
                        onChange={(e) => setAppsScriptSecret(e.target.value)}
                        placeholder="COMEY_INGEST_SECRET"
                        className="cm-input font-mono-num"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={savingOnDemand}
                      className="cm-btn cm-btn-secondary h-8 text-[12px]"
                    >
                      {savingOnDemand ? 'Đang lưu...' : 'Lưu URL On-Demand'}
                    </button>
                  </form>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="cm-btn cm-btn-secondary"
                >
                  <ArrowLeft className="w-4 h-4" /> Quay lại
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="cm-btn cm-btn-primary"
                >
                  Tiếp tục bước 3 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-[10px] border border-black/[0.08] p-5 space-y-4">
                <div>
                  <h4 className="text-[14px] font-semibold text-[#09090B] flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-[#047857]" />
                    Tạo nhanh luật nhận Webhook
                  </h4>
                  <p className="text-[12.5px] text-[#52525B] mt-1">
                    Giao dịch khớp tiền tố mã đơn sẽ được ký HMAC-SHA256 và chuyển tới máy chủ đích.
                  </p>
                </div>

                <form onSubmit={handleCreateQuickRule} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="wiz-rule-prefix" className="block text-[12px] font-medium mb-1">
                        Tiền tố (Prefix)
                      </label>
                      <input
                        id="wiz-rule-prefix"
                        type="text"
                        required
                        value={rulePrefix}
                        onChange={(e) => setRulePrefix(e.target.value)}
                        placeholder="SHOP"
                        className="cm-input font-mono-num"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="wiz-rule-webhook" className="block text-[12px] font-medium mb-1">
                        Webhook URL (HTTPS)
                      </label>
                      <input
                        id="wiz-rule-webhook"
                        type="url"
                        required
                        value={ruleWebhookUrl}
                        onChange={(e) => setRuleWebhookUrl(e.target.value)}
                        placeholder="https://your-app.com/webhooks/comey"
                        className="cm-input font-mono-num"
                      />
                    </div>
                  </div>
                  {step3Error && (
                    <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] font-medium text-[#DC2626]">
                      {step3Error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={creatingRule}
                    className="cm-btn cm-btn-primary"
                  >
                    {creatingRule ? 'Đang tạo luật...' : 'Lưu luật Webhook'}
                  </button>
                </form>

                {createdRuleSecret && (
                  <div className="rounded-[8px] bg-[#ECFDF5] border border-[#A7F3D0] p-3.5 flex items-center justify-between gap-3">
                    <div className="text-[12.5px] text-[#047857] min-w-0">
                      <div className="font-semibold">Webhook Signing Secret</div>
                      <code className="font-mono-num font-semibold break-all text-[#09090B]">
                        {createdRuleSecret}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy(createdRuleSecret, 'rule_sec', 'Webhook Secret')}
                      className="cm-btn cm-btn-primary h-8 px-3 text-[12px]"
                    >
                      {copiedKey === 'rule_sec' ? 'Đã chép' : 'Sao chép'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="cm-btn cm-btn-secondary"
                >
                  <ArrowLeft className="w-4 h-4" /> Quay lại
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="cm-btn cm-btn-primary"
                >
                  {createdRuleSecret ? 'Tiếp tục bước 4' : 'Bỏ qua sang bước 4'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-[10px] border border-black/[0.08] p-5 space-y-4">
                <div>
                  <h4 className="text-[14px] font-semibold text-[#09090B]">
                    Kiểm thử toàn trình không cần chuyển khoản thật
                  </h4>
                  <p className="text-[12.5px] text-[#52525B] mt-1">
                    Mô phỏng giao dịch đi qua Parser, đối soát mã đơn và gửi Webhook ký HMAC-SHA256.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wiz-sim-amount" className="block text-[12px] font-medium mb-1">
                      Số tiền giả lập (VNĐ)
                    </label>
                    <input
                      id="wiz-sim-amount"
                      type="number"
                      min={1000}
                      value={simAmount}
                      onChange={(e) => setSimAmount(Number(e.target.value))}
                      className="cm-input font-mono-num"
                    />
                  </div>
                  <div>
                    <label htmlFor="wiz-sim-content" className="block text-[12px] font-medium mb-1">
                      Nội dung chuyển khoản
                    </label>
                    <input
                      id="wiz-sim-content"
                      type="text"
                      value={simContent}
                      onChange={(e) => setSimContent(e.target.value)}
                      className="cm-input font-mono-num"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={simRunning}
                  onClick={() => void handleRunVerificationSim()}
                  className="cm-btn cm-btn-emerald"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {simRunning ? 'Đang chạy kiểm thử...' : 'Chạy kiểm thử ngay'}
                </button>

                {simResult && (
                  <div className="rounded-[8px] bg-[#FAFAFA] border border-black/[0.08] p-4 space-y-2 text-[12.5px]">
                    <div className="flex items-center gap-2 font-medium text-[#047857]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Parser &amp; Lưu giao dịch: {simResult.status} ({simResult.transaction?.bankTxId})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-medium text-[#047857]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Khớp mã / Phiên: {simResult.matchedOrderCode || 'Không có'} (
                        {simResult.sessionAction || 'Layer 1'})
                      </span>
                    </div>
                    <div className="flex items-start gap-2 font-medium text-[#09090B]">
                      <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
                      <div>
                        Chuyển tiếp:{' '}
                        {simResult.deliveries && simResult.deliveries.length > 0
                          ? simResult.deliveries
                              .map((d) => `${d.eventType} (${d.status}, HTTP ${d.httpStatus ?? 'err'})`)
                              .join(', ')
                          : 'Chưa gắn Webhook đích'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="cm-btn cm-btn-secondary"
                >
                  <ArrowLeft className="w-4 h-4" /> Quay lại
                </button>
                <button type="button" onClick={onClose} className="cm-btn cm-btn-primary">
                  Hoàn tất thiết lập
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
