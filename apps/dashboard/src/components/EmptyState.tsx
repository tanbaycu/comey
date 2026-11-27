import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: PhIcon,
  title,
  description,
  action,
  dashed = false,
}: {
  icon: Icon;
  title: string;
  description: string;
  action?: ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={`cm-panel p-11 text-center flex flex-col items-center justify-center gap-3.5 ${
        dashed ? 'border-dashed' : ''
      }`}
    >
      <span className="w-12 h-12 rounded-[12px] bg-[#F4F4F5] border border-black/[0.08] flex items-center justify-center text-[#09090B]">
        <PhIcon size={24} weight="duotone" className="text-[#047857]" />
      </span>
      <div className="space-y-1 max-w-md">
        <div className="text-[14px] font-semibold tracking-[-0.015em] text-[#09090B]">{title}</div>
        <p className="text-[13px] text-[#71717A] leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
