import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={280} skipDelayDuration={220}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tip({
  label,
  shortcut,
  side = 'top',
  children,
}: {
  label: string;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="cm-pop-content z-50 inline-flex items-center gap-2 rounded-[7px] bg-[#09090B] px-2.5 py-1.5 text-[11.5px] font-medium text-white shadow-lg border border-white/10 select-none"
        >
          <span>{label}</span>
          {shortcut && (
            <kbd className="font-mono-num text-[10px] text-zinc-300 bg-white/10 px-1 py-0.5 rounded-[4px]">
              {shortcut}
            </kbd>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
