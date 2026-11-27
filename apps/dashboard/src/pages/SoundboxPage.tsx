import { CheckCircle, SpeakerHigh } from '@phosphor-icons/react';
import {
  Check,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Plus,
  QrCode,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../components/Badge';
import { BankEmblem, BankLogo } from '../components/BankEmblem';
import { BrandIcon } from '../components/BrandIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { SheetDrawer } from '../components/SheetDrawer';
import { Tip } from '../components/Tooltip';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatVnd } from '../lib/format';
import type { BankAccount, SoundboxItem } from '../lib/types';

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    return sharedAudioContext;
  }
  const AudioCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  sharedAudioContext = new AudioCtor();
  return sharedAudioContext;
}

function playBrowserChimeAndSpeak(text: string): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getSharedAudioContext();
    if (ctx) {
      const scheduleTones = () => {
        const now = ctx.currentTime;
        const playTone = (freq: number, offset: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + offset);
          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + duration);
        };
        playTone(1046.5, 0, 0.22);
        playTone(1318.5, 0.14, 0.35);
      };
      if (ctx.state === 'suspended') {
        void ctx.resume().then(scheduleTones).catch(() => {});
      } else {
        scheduleTones();
      }
    }
  } catch {
    // Ignore audio context blocks
  }

  if ('speechSynthesis' in window) {
    try {
      window.setTimeout(() => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'vi-VN';
        utter.rate = 1.02;
        const voices = window.speechSynthesis.getVoices();
        const viVoice = voices.find((v) => v.lang.toLowerCase().startsWith('vi'));
        if (viVoice) utter.voice = viVoice;
        window.speechSynthesis.speak(utter);
      }, 260);
    } catch {
      // Ignore speech synthesis errors on headless browsers
    }
  }
}

const ESP32_SNIPPET = `// Arduino / ESP32 Comey Soundbox Poller
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* EVENTS_URL = "https://your-comey-domain.workers.dev/api/soundbox/events";
const char* BEARER_TOKEN = "sbx_YOUR_TOKEN";
String cursor = "";

void pollComeySoundbox() {
  HTTPClient http;
  String url = String(EVENTS_URL) + (cursor.length() ? "?since=" + cursor + "&limit=10" : "?limit=1");
  http.begin(url);
  http.addHeader("Authorization", String("Bearer ") + BEARER_TOKEN);
  if (http.GET() == 200) {
    StaticJsonDocument<2048> doc;
    if (!deserializeJson(doc, http.getString()) && doc["ok"]) {
      cursor = doc["nextCursor"].as<String>();
      for (JsonObject ev : doc["events"].as<JsonArray>()) {
        long amount = ev["amount"];
        const char* speechText = ev["speechText"];
        Serial.printf("+%ld VND -> %s\\n", amount, speechText);
      }
    }
  }
  http.end();
}`;

export function SoundboxPage({
  accounts,
  soundboxes,
  onReload,
  onReloadAfterTest,
  onNotify,
  openCreateSignal = 0,
}: {
  accounts: BankAccount[];
  soundboxes: SoundboxItem[];
  onReload: () => Promise<void>;
  onReloadAfterTest?: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
  openCreateSignal?: number;
}) {
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [espDrawerOpen, setEspDrawerOpen] = useState(false);

  const [name, setName] = useState('Loa Thu Ngân Quầy 1');
  const [bankAccountId, setBankAccountId] = useState('');
  const [minAmount, setMinAmount] = useState(0);
  const [voiceLang, setVoiceLang] = useState('vi-VN');
  const [voiceTemplate, setVoiceTemplate] = useState('Đã nhận {amountWords} {currency}');
  const [creating, setCreating] = useState(false);

  const [revealedUrls, setRevealedUrls] = useState<{
    name: string;
    kioskUrl: string;
    eventsUrl: string;
  } | null>(null);

  const [simAccountId, setSimAccountId] = useState(accounts[0]?.id || '');
  const [simulating, setSimulating] = useState(false);

  const [rotateTarget, setRotateTarget] = useState<SoundboxItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SoundboxItem | null>(null);

  useEffect(() => {
    if (openCreateSignal > 0) {
      setCreateDrawerOpen(true);
    }
  }, [openCreateSignal]);

  const activeSimAccountId = simAccountId || accounts[0]?.id || '';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.soundboxes.create({
        name: name.trim() || 'Loa Thu Ngân',
        bankAccountId: bankAccountId || null,
        minAmount,
        voiceLang,
        voiceTemplate,
      });
      setRevealedUrls({
        name: res.soundbox.name,
        kioskUrl: res.kioskUrl,
        eventsUrl: res.eventsUrl,
      });
      setCreateDrawerOpen(false);
      await onReload();
      onNotify('success', `Đã tạo Loa "${res.soundbox.name}"`);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể tạo Loa');
    } finally {
      setCreating(false);
    }
  }

  async function handleQuickTestSpeaker() {
    if (!activeSimAccountId) {
      playBrowserChimeAndSpeak('Đã nhận tám mươi nghìn đồng');
      onNotify('success', 'Đã phát thử âm thanh trên trình duyệt');
      return;
    }

    setSimulating(true);
    try {
      await api.simulator.transfer({
        bankAccountId: activeSimAccountId,
        amount: 80000,
        content: `TESTLOA ${Date.now().toString().slice(-4)} Thu am thanh`,
        senderName: 'KIEM THU LOA',
      });
      playBrowserChimeAndSpeak('Đã nhận tám mươi nghìn đồng');
      await (onReloadAfterTest ? onReloadAfterTest() : onReload());
      onNotify('success', 'Đã phát thử thông báo +80.000đ tới tất cả Loa đang hoạt động');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi phát thử giao dịch');
    } finally {
      setSimulating(false);
    }
  }

  async function handleToggle(sb: SoundboxItem) {
    try {
      await api.soundboxes.update(sb.id, { enabled: !sb.enabled });
      await onReload();
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Không thể đổi trạng thái Loa');
    }
  }

  async function handleRotateConfirmed() {
    if (!rotateTarget) return;
    try {
      const res = await api.soundboxes.rotateToken(rotateTarget.id);
      setRevealedUrls({
        name: rotateTarget.name,
        kioskUrl: res.kioskUrl,
        eventsUrl: res.eventsUrl,
      });
      await onReload();
      onNotify('success', `Đã cấp lại liên kết mới cho "${rotateTarget.name}"`);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi cấp lại token');
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    try {
      await api.soundboxes.remove(deleteTarget.id);
      await onReload();
      onNotify('success', 'Đã xóa thiết bị Loa');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi xóa thiết bị');
    }
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
            Loa thu ngân &amp; POS Mini 2-in-1
          </h2>
          <p className="text-[13px] text-[#71717A] mt-0.5 max-w-2xl">
            Liên kết Web Kiosk cho phép tạo nhanh mã VietQR ngay tại quầy, tự chuyển trạng thái
            xanh khi nhận đủ tiền, đọc tiếng Việt và đồng bộ cho phần cứng ESP32.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {accounts.length > 0 && (
            <select
              id="sbx-sim-account"
              aria-label="Chọn tài khoản nhận thử nghiệm cho Loa"
              value={activeSimAccountId}
              onChange={(e) => setSimAccountId(e.target.value)}
              className="cm-input w-auto h-[38px] text-[12.5px]"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankCode} ({a.accountNumber})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={simulating}
            onClick={() => void handleQuickTestSpeaker()}
            className="cm-btn cm-btn-secondary"
          >
            <FlaskConical className="w-3.5 h-3.5 text-[#047857]" />
            {simulating ? 'Đang phát...' : 'Phát thử +80.000đ'}
          </button>

          <button
            type="button"
            onClick={() => setEspDrawerOpen(true)}
            className="cm-btn cm-btn-secondary"
          >
            <BrandIcon id="arduino" size={16} /> Mã ESP32
          </button>

          <button
            type="button"
            onClick={() => setCreateDrawerOpen(true)}
            className="cm-btn cm-btn-primary"
          >
            <Plus className="w-4 h-4" /> Tạo loa thu ngân
          </button>
        </div>
      </div>

      {revealedUrls && (
        <div className="cm-panel border-[#A7F3D0] bg-[#ECFDF5]/60 p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[13.5px] font-semibold text-[#047857]">
              Liên kết kích hoạt Loa &ldquo;{revealedUrls.name}&rdquo; (chỉ hiển thị một lần sau khi
              tạo hoặc cấp mới)
            </div>
            <Badge tone="green">Hoạt động ngay</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 rounded-[8px] bg-white border border-[#A7F3D0] p-3.5 space-y-2.5">
              <div className="text-[12px] font-medium text-[#52525B]">
                Link Web Kiosk kèm POS Mini 2-in-1
              </div>
              <code className="block text-[12px] font-mono-num text-[#09090B] break-all">
                {revealedUrls.kioskUrl}
              </code>
              <div className="flex flex-wrap gap-2 pt-0.5">
                <a
                  href={revealedUrls.kioskUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="cm-btn cm-btn-primary h-8 px-3 text-[12px]"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Mở Kiosk POS
                </a>
                <CopyButton
                  value={revealedUrls.kioskUrl}
                  label="Sao chép link"
                  size="sm"
                  onCopied={(ok) =>
                    onNotify(
                      ok ? 'success' : 'error',
                      ok ? 'Đã sao chép Kiosk URL' : 'Lỗi sao chép'
                    )
                  }
                />
              </div>
            </div>

            <div className="min-w-0 rounded-[8px] bg-white border border-[#A7F3D0] p-3.5 space-y-2.5">
              <div className="text-[12px] font-medium text-[#52525B]">
                API JSON Polling cho phần cứng ESP32
              </div>
              <code className="block text-[12px] font-mono-num text-[#09090B] break-all">
                {revealedUrls.eventsUrl}
              </code>
              <div className="pt-0.5">
                <CopyButton
                  value={revealedUrls.eventsUrl}
                  label="Sao chép API URL"
                  size="sm"
                  onCopied={(ok) =>
                    onNotify(
                      ok ? 'success' : 'error',
                      ok ? 'Đã sao chép IoT API URL' : 'Lỗi sao chép'
                    )
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {soundboxes.length === 0 ? (
        <div className="cm-panel overflow-hidden grid lg:grid-cols-12">
          <div className="lg:col-span-6 p-6 sm:p-7 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <span className="cm-kpi-badge cm-kpi-badge-emerald w-10 h-10 rounded-[10px]">
                <SpeakerHigh size={20} weight="duotone" />
              </span>
              <div className="space-y-1.5">
                <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-[#09090B]">
                  Loa thông báo &amp; Màn hình POS Mini 2-in-1
                </h3>
                <p className="text-[13.5px] text-[#52525B] leading-relaxed">
                  Biến điện thoại, máy tính bảng tại quầy hoặc mạch ESP32 thành loa báo tiền vào
                  kèm màn hình hiển thị mã VietQR tính tiền tự động chuyển xanh khi khách chuyển
                  khoản.
                </p>
              </div>
              <ul className="space-y-2 text-[13px] text-[#52525B]">
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>Đọc số tiền tiếng Việt tức thì kèm chuông báo giao dịch</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>Tạo QR POS trực tiếp theo từng hóa đơn ngay trên quầy</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="duotone" className="text-[#047857] shrink-0" />
                  <span>API polling nhẹ cho Arduino / ESP32 có con trỏ chống đọc lặp</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setCreateDrawerOpen(true)}
                className="cm-btn cm-btn-primary"
              >
                <Plus className="w-4 h-4" /> Tạo loa đầu tiên
              </button>
              <button
                type="button"
                disabled={simulating}
                onClick={() => void handleQuickTestSpeaker()}
                className="cm-btn cm-btn-secondary"
              >
                <FlaskConical className="w-3.5 h-3.5 text-[#047857]" />
                {simulating ? 'Đang phát...' : 'Phát thử +80.000đ'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 bg-[#F5F6F7] p-6 sm:p-7 border-t lg:border-t-0 lg:border-l border-black/[0.07] flex items-center justify-center">
            <div className="w-full max-w-[330px] rounded-[16px] bg-[#09090B] text-white p-4 shadow-xl border border-white/10 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="cm-eq-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="text-[12px] font-semibold text-zinc-100 truncate">
                    POS Mini Kiosk
                  </span>
                </div>
                <span className="font-mono-num text-[10px] font-semibold text-[#34D399] bg-white/10 border border-white/10 px-2 py-0.5 rounded-[5px]">
                  LIVE SYNC
                </span>
              </div>

              <div className="rounded-[12px] bg-white text-[#09090B] p-3.5 flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-[8px] border border-black/[0.08] bg-[#F5F6F7] flex items-center justify-center shrink-0">
                  <QrCode className="w-9 h-9 text-[#09090B]" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <BankLogo code={accounts[0]?.bankCode || 'MB'} size="xs" />
                  <div className="font-mono-num text-[17px] font-semibold text-[#047857]">
                    +80.000 đ
                  </div>
                  <div className="text-[11px] text-[#52525B] truncate">
                    &ldquo;Đã nhận tám mươi nghìn đồng&rdquo;
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <BrandIcon id="arduino" size={14} tile onDark />
                  <span>ESP32 Poller Ready</span>
                </span>
                <span className="font-mono-num text-zinc-300">vi-VN</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {soundboxes.map((sb) => {
            const acc = accounts.find((a) => a.id === sb.bankAccountId);
            return (
              <div
                key={sb.id}
                className="cm-panel cm-card-interactive p-5 flex flex-col justify-between gap-4 min-w-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`w-10 h-10 rounded-[10px] border flex items-center justify-center shrink-0 ${
                        sb.enabled
                          ? 'bg-[#09090B] border-[#09090B] text-[#34D399]'
                          : 'bg-[#F4F4F5] border-black/[0.08] text-[#71717A]'
                      }`}
                    >
                      <SpeakerHigh size={18} weight="duotone" />
                    </span>
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-[#09090B] truncate">
                          {sb.name}
                        </span>
                        {sb.enabled && (
                          <span className="cm-eq-bars" aria-hidden="true" title="Đang lắng nghe">
                            <i />
                            <i />
                            <i />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleToggle(sb)}
                          className="cursor-pointer"
                        >
                          <Badge tone={sb.enabled ? 'green' : 'slate'}>
                            {sb.enabled ? 'Đang bật' : 'Tạm tắt'}
                          </Badge>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-[12.5px] text-[#52525B] font-mono-num">
                        {acc ? (
                          <>
                            <BankEmblem code={acc.bankCode} size="sm" />
                            <span>{acc.accountNumber}</span>
                          </>
                        ) : (
                          <span>Theo dõi toàn bộ tài khoản</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Tip label="Xóa thiết bị Loa" side="left">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(sb)}
                      className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-[7px] text-[#71717A] hover:text-[#DC2626] hover:bg-rose-50 cursor-pointer shrink-0 transition-colors duration-150"
                      aria-label={`Xóa Loa ${sb.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Tip>
                </div>

                <div className="grid grid-cols-3 gap-3 rounded-[8px] bg-[#FAFAFA] border border-black/[0.06] px-3.5 py-2.5 text-[12px]">
                  <div>
                    <div className="text-[#71717A] text-[11px]">Ngưỡng tối thiểu</div>
                    <div className="font-mono-num font-medium text-[#09090B] mt-0.5">
                      {formatVnd(sb.minAmount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#71717A] text-[11px]">Mã token</div>
                    <div className="font-mono-num font-medium text-[#09090B] mt-0.5 truncate">
                      {sb.tokenPreview}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#71717A] text-[11px]">Kết nối cuối</div>
                    <div className="font-medium mt-0.5 truncate">
                      {sb.lastSeenAt ? (
                        <span className="inline-flex items-center gap-1 text-[#047857]">
                          <Check className="w-3 h-3 shrink-0" /> {formatDateTime(sb.lastSeenAt)}
                        </span>
                      ) : (
                        <span className="text-[#71717A]">Chưa kết nối</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/[0.06]">
                  <span className="text-[12px] text-[#71717A]">Giọng đọc: {sb.voiceLang}</span>
                  <button
                    type="button"
                    onClick={() => setRotateTarget(sb)}
                    className="cm-btn cm-btn-secondary h-8 px-3 text-[12px]"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> Cấp lại link
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SheetDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        title="Tạo loa thu ngân mới"
        subtitle="Thiết lập phạm vi tài khoản, ngưỡng số tiền tối thiểu và mẫu câu đọc thông báo."
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateDrawerOpen(false)}
              className="cm-btn cm-btn-secondary"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              form="sbx-create-form"
              disabled={creating}
              className="cm-btn cm-btn-primary"
            >
              {creating ? 'Đang tạo...' : 'Tạo thiết bị'}
            </button>
          </div>
        }
      >
        <form id="sbx-create-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="sbx-name" className="block text-[12.5px] font-medium mb-1.5">
              Tên thiết bị hoặc quầy thu ngân
            </label>
            <input
              id="sbx-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Quầy Thu Ngân 1"
              className="cm-input"
            />
          </div>

          <div>
            <label htmlFor="sbx-bank-account" className="block text-[12.5px] font-medium mb-1.5">
              Tài khoản theo dõi &amp; xuất QR POS
            </label>
            <select
              id="sbx-bank-account"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="cm-input"
            >
              <option value="">Tất cả tài khoản trong Workspace</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankCode} ({a.accountNumber})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sbx-min-amount" className="block text-[12.5px] font-medium mb-1.5">
                Ngưỡng tiền tối thiểu (VNĐ)
              </label>
              <input
                id="sbx-min-amount"
                type="number"
                min={0}
                step={1000}
                value={minAmount}
                onChange={(e) => setMinAmount(Math.max(0, Number(e.target.value)))}
                className="cm-input font-mono-num"
              />
            </div>
            <div>
              <label htmlFor="sbx-voice-lang" className="block text-[12.5px] font-medium mb-1.5">
                Ngôn ngữ giọng đọc
              </label>
              <select
                id="sbx-voice-lang"
                value={voiceLang}
                onChange={(e) => setVoiceLang(e.target.value)}
                className="cm-input"
              >
                <option value="vi-VN">Tiếng Việt (vi-VN)</option>
                <option value="en-US">English (en-US)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="sbx-voice-template" className="block text-[12.5px] font-medium mb-1.5">
              Mẫu câu thông báo
            </label>
            <input
              id="sbx-voice-template"
              type="text"
              value={voiceTemplate}
              onChange={(e) => setVoiceTemplate(e.target.value)}
              className="cm-input font-mono-num"
            />
            <p className="text-[11.5px] text-[#71717A] mt-1.5 font-mono-num">
              Biến hỗ trợ: {'{amountWords}'} {'{amountFormatted}'} {'{currency}'} {'{senderName}'}
            </p>
          </div>
        </form>
      </SheetDrawer>

      <SheetDrawer
        open={espDrawerOpen}
        onClose={() => setEspDrawerOpen(false)}
        size="lg"
        title="Tích hợp phần cứng ESP32 / Arduino"
        subtitle="Sử dụng Bearer Token header khi gọi endpoint /api/soundbox/events để tăng bảo mật."
        footer={
          <div className="flex justify-end">
            <CopyButton
              value={ESP32_SNIPPET}
              label="Sao chép mã ESP32"
              variant="dark"
              onCopied={(ok) =>
                onNotify(ok ? 'success' : 'error', ok ? 'Đã sao chép code ESP32' : 'Lỗi sao chép')
              }
            />
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[8px] border border-black/[0.08] bg-[#FAFAFA] px-3.5 py-2.5 flex items-center gap-3">
            <BrandIcon id="arduino" size={20} tile />
            <div className="text-[12.5px] text-[#52525B]">
              Hỗ trợ <span className="font-semibold text-[#09090B]">Arduino / ESP32-S3</span> polling
              tối ưu với con trỏ <code className="font-mono-num">nextCursor</code>.
            </div>
          </div>
          <pre className="overflow-x-auto rounded-[8px] bg-[#09090B] text-zinc-100 p-4 text-[12px] font-mono-num leading-relaxed">
            {ESP32_SNIPPET}
          </pre>
        </div>
      </SheetDrawer>

      <ConfirmModal
        open={Boolean(rotateTarget)}
        title="Cấp lại liên kết Loa mới"
        description={
          rotateTarget
            ? `Liên kết Kiosk và token IoT cũ của "${rotateTarget.name}" sẽ ngừng hoạt động ngay lập tức.`
            : ''
        }
        confirmLabel="Cấp lại liên kết"
        onConfirm={handleRotateConfirmed}
        onClose={() => setRotateTarget(null)}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Xóa thiết bị Loa"
        description={
          deleteTarget ? `Thiết bị "${deleteTarget.name}" sẽ bị xóa vĩnh viễn.` : ''
        }
        confirmLabel="Xóa thiết bị"
        destructive
        onConfirm={handleDeleteConfirmed}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
