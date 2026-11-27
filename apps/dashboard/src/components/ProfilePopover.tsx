import * as Popover from '@radix-ui/react-popover';
import { ChevronsUpDown, LogOut, Rocket, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { UserInfo, WorkspaceInfo } from '../lib/types';
import { IdentityAvatar } from './IdentityAvatar';

export function ProfilePopover({
  user,
  workspace,
  onNavigate,
  onOpenPalette,
  onLogout,
}: {
  user: UserInfo;
  workspace: WorkspaceInfo | null;
  onNavigate?: (tab: string) => void;
  onOpenPalette: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isProd = typeof window !== 'undefined' && window.location.protocol === 'https:';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Tài khoản workspace"
          className="h-[34px] inline-flex items-center gap-2 rounded-[9px] border border-black/[0.08] bg-white hover:bg-[#F5F6F7] pl-1.5 pr-2.5 cursor-pointer transition-colors duration-150 shrink-0"
        >
          <IdentityAvatar seed={user.email} name={user.name} size="xs" ring="live" />
          <span className="hidden sm:inline text-[12.5px] font-medium text-[#09090B] max-w-[120px] truncate">
            {user.name}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="cm-pop-content z-50 w-[256px] rounded-[12px] bg-white border border-black/[0.1] shadow-xl p-2.5 space-y-2"
        >
          <div className="flex items-start gap-2.5 px-1.5 pt-1 pb-2.5 border-b border-black/[0.06]">
            <IdentityAvatar seed={user.email} name={user.name} size="md" ring="obsidian" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[#09090B] truncate">
                {workspace?.name || user.name}
              </div>
              <div className="text-[11.5px] text-[#71717A] truncate">{user.email}</div>
              <div className="mt-1.5">
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-[#ECFDF5] border border-[#A7F3D0] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#047857]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                  {isProd ? 'Production Edge' : 'Local Studio'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-0.5">
            {onNavigate && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onNavigate('developers');
                  }}
                  className="w-full flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] hover:bg-[#F5F6F7] cursor-pointer transition-colors duration-100"
                >
                  <Rocket className="w-3.5 h-3.5 text-[#047857]" />
                  <span>Triển khai lên Cloudflare</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onNavigate('security');
                  }}
                  className="w-full flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] hover:bg-[#F5F6F7] cursor-pointer transition-colors duration-100"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Bảo mật tài khoản</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenPalette();
              }}
              className="w-full flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-[#52525B] hover:text-[#09090B] hover:bg-[#F5F6F7] cursor-pointer transition-colors duration-100"
            >
              <span className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5" /> Tìm nhanh
              </span>
              <kbd className="font-mono-num text-[10.5px] text-[#71717A] bg-white px-1.5 py-0.5 rounded-[4px] border border-black/[0.08]">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="pt-1.5 border-t border-black/[0.06]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-[#DC2626] hover:bg-rose-50 cursor-pointer transition-colors duration-100"
            >
              <LogOut className="w-3.5 h-3.5" /> Đăng xuất
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
