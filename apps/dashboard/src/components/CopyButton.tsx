import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '../lib/format';

export function CopyButton({
  value,
  label,
  copiedLabel = 'Đã sao chép',
  onCopied,
  variant = 'outline',
  size = 'sm',
  className = '',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  onCopied?: (ok: boolean) => void;
  variant?: 'outline' | 'dark' | 'ghost';
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
    onCopied?.(ok);
  }

  const variantCls =
    variant === 'dark'
      ? 'bg-[#09090B] text-white border border-[#09090B] hover:bg-[#18181B]'
      : variant === 'ghost'
        ? 'bg-transparent text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] border border-transparent'
        : 'bg-white text-[#09090B] border border-black/[0.12] hover:bg-[#F4F4F5] hover:border-black/[0.2]';

  const sizeCls =
    size === 'xs'
      ? label
        ? 'h-7 px-2 text-[11.5px] rounded-[6px]'
        : 'h-7 w-7 rounded-[6px]'
      : label
        ? 'h-8 px-2.5 text-[12px] rounded-[7px]'
        : 'h-8 w-8 rounded-[7px]';

  return (
    <button
      type="button"
      onClick={(e) => void handleCopy(e)}
      aria-label={label || 'Sao chép'}
      title={copied ? copiedLabel : label || 'Sao chép'}
      className={`inline-flex items-center justify-center gap-1.5 font-medium shrink-0 cursor-pointer active:scale-[0.96] transition-[transform,background-color,border-color,color] duration-150 ${variantCls} ${sizeCls} ${className}`.trim()}
    >
      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
        <Copy
          className={`w-3.5 h-3.5 absolute cm-copy-glyph ${
            copied ? 'opacity-0 scale-75 blur-[2px]' : 'opacity-100 scale-100 blur-0'
          }`}
        />
        <Check
          className={`w-3.5 h-3.5 absolute text-[#047857] cm-copy-glyph ${
            copied ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-75 blur-[2px]'
          } ${variant === 'dark' && copied ? 'text-[#34D399]' : ''}`}
        />
      </span>
      {label && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
}
