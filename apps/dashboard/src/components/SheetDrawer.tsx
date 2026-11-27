import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function StudioModal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
}) {
  const widthClass =
    size === 'xl'
      ? 'max-w-[840px]'
      : size === 'lg'
        ? 'max-w-[700px]'
        : 'max-w-[540px]';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="cm-modal-overlay fixed inset-0 z-50 bg-black/35 backdrop-blur-[3px]" />
        <Dialog.Content
          className={`cm-modal-content fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] ${widthClass} max-h-[88vh] rounded-[16px] bg-white border border-black/[0.08] shadow-2xl flex flex-col overflow-hidden focus:outline-none`}
        >
          <header className="px-6 py-4 border-b border-black/[0.08] flex items-start justify-between gap-4 shrink-0 bg-white">
            <div className="min-w-0">
              <Dialog.Title className="text-[15.5px] font-semibold tracking-[-0.02em] text-[#09090B] truncate">
                {title}
              </Dialog.Title>
              {subtitle ? (
                <Dialog.Description className="text-[12.5px] text-[#71717A] mt-0.5 leading-snug">
                  {subtitle}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Đóng hộp thoại"
                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-[8px] text-[#71717A] hover:text-[#09090B] hover:bg-[#F5F6F7] active:scale-[0.96] transition-[transform,background-color,color] duration-150 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">{children}</div>

          {footer && (
            <footer className="px-6 py-3.5 border-t border-black/[0.08] bg-[#F5F6F7]/70 shrink-0">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetDrawer = StudioModal;
