import {
  Key,
  PlayCircle,
  PlusCircle,
  QrCode as PhQrCode,
  RocketLaunch,
  ShareNetwork,
  SpeakerHigh,
} from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import type { QuickActionId } from './CommandPalette';

const CREATE_ITEMS: Array<{
  id: QuickActionId;
  group: 'Khởi tạo nhanh' | 'Kiểm thử & API';
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; weight?: 'duotone' | 'regular'; className?: string }>;
}> = [
  {
    id: 'new-account',
    group: 'Khởi tạo nhanh',
    label: 'Thêm tài khoản ngân hàng',
    desc: 'Hỗ trợ 12 ngân hàng Việt Nam & VietQR',
    icon: PlusCircle,
  },
  {
    id: 'new-rule',
    group: 'Khởi tạo nhanh',
    label: 'Tạo kênh Telegram / Webhook',
    desc: 'Chuyển tiếp số dư sang Telegram, Discord, Sheets',
    icon: ShareNetwork,
  },
  {
    id: 'dynamic-qr',
    group: 'Khởi tạo nhanh',
    label: 'Tạo ảnh VietQR động',
    desc: 'URL ảnh PNG / SVG nhúng ngay không cần DB',
    icon: PhQrCode,
  },
  {
    id: 'new-soundbox',
    group: 'Khởi tạo nhanh',
    label: 'Tạo Loa thu ngân POS Mini',
    desc: 'Đọc giọng nói tiếng Việt & đồng bộ ESP32',
    icon: SpeakerHigh,
  },
  {
    id: 'simulate-tx',
    group: 'Kiểm thử & API',
    label: 'Mô phỏng giao dịch +80.000đ',
    desc: 'Chạy thử Parser & đối soát toàn trình',
    icon: PlayCircle,
  },
  {
    id: 'deploy-guide',
    group: 'Kiểm thử & API',
    label: 'Triển khai lên Cloudflare Edge',
    desc: 'Sinh CLI, wrangler.jsonc & kiểm tra /health',
    icon: RocketLaunch,
  },
  {
    id: 'new-apikey',
    group: 'Kiểm thử & API',
    label: 'Tạo API Key phân quyền RBAC',
    desc: 'Giới hạn scope, RPM & IP Allowlist',
    icon: Key,
  },
];

export function QuickCreatePopover({
  onQuickAction,
}: {
  onQuickAction: (action: QuickActionId) => void;
}) {
  const [open, setOpen] = useState(false);

  const primaryGroup = CREATE_ITEMS.filter((i) => i.group === 'Khởi tạo nhanh');
  const devGroup = CREATE_ITEMS.filter((i) => i.group === 'Kiểm thử & API');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cm-btn cm-btn-primary h-[34px] min-h-[34px] px-3 text-[12.5px] rounded-[9px]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tạo mới</span>
          <ChevronDown className="w-3 h-3 opacity-75 hidden sm:inline" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="cm-pop-content z-50 w-[308px] rounded-[12px] bg-white border border-black/[0.1] shadow-xl p-2 space-y-2"
        >
          <div>
            <div className="px-2.5 py-1 text-[11px] font-medium text-[#71717A]">Khởi tạo nhanh</div>
            <div className="space-y-0.5">
              {primaryGroup.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onQuickAction(item.id);
                    }}
                    className="w-full flex items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-[#F5F6F7] cursor-pointer transition-colors duration-100"
                  >
                    <span className="w-7 h-7 rounded-[7px] bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center shrink-0 mt-0.5">
                      <Icon size={15} weight="duotone" className="text-[#047857]" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#09090B] leading-snug">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-[#71717A] leading-snug mt-0.5">
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-black/[0.06] pt-1.5">
            <div className="px-2.5 py-1 text-[11px] font-medium text-[#71717A]">
              Kiểm thử &amp; Tích hợp
            </div>
            <div className="space-y-0.5">
              {devGroup.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onQuickAction(item.id);
                    }}
                    className="w-full flex items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-[#F5F6F7] cursor-pointer transition-colors duration-100"
                  >
                    <span className="w-7 h-7 rounded-[7px] bg-[#F5F6F7] border border-black/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                      <Icon size={15} weight="duotone" className="text-[#09090B]" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#09090B] leading-snug">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-[#71717A] leading-snug mt-0.5">
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
