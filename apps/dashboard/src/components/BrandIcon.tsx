import { PlugsConnected, ShieldCheck } from '@phosphor-icons/react';
import type { WebhookPayloadFormat } from '../lib/types';

export type BrandIconId =
  | 'telegram'
  | 'discord'
  | 'google-sheets'
  | 'gmail'
  | 'cloudflare'
  | 'cloudflare-workers'
  | 'sqlite'
  | 'nodejs'
  | 'typescript'
  | 'python'
  | 'php'
  | 'arduino'
  | 'postman';

export function BrandIcon({
  id,
  size = 20,
  tile = false,
  onDark = false,
  label = '',
  className = '',
}: {
  id: BrandIconId;
  size?: number;
  tile?: boolean;
  onDark?: boolean;
  label?: string;
  className?: string;
}) {
  const img = (
    <img
      src={`/assets/icons/${id}.svg`}
      alt={label}
      width={size}
      height={size}
      loading="eager"
      decoding="sync"
      style={{ width: size, height: size }}
      className={`object-contain shrink-0 ${tile ? '' : className}`.trim()}
    />
  );

  if (!tile) return img;

  const boxSize = Math.max(size + 12, 28);
  return (
    <span
      style={{ width: boxSize, height: boxSize }}
      className={`cm-icon-tile ${
        onDark ? 'bg-white border-white/20' : 'bg-white border-black/[0.08]'
      } ${className}`.trim()}
    >
      {img}
    </span>
  );
}

export function ComeyMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#09090B" />
      <rect
        x="7"
        y="7"
        width="18"
        height="18"
        rx="4.5"
        fill="none"
        stroke="#10B981"
        strokeWidth="2"
      />
      <path
        d="M12.5 16.2l2.4 2.4 4.8-5.3"
        stroke="#FAFAFA"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChannelBadgeIcon({
  format,
  size = 18,
  onDark = false,
}: {
  format: WebhookPayloadFormat;
  size?: number;
  onDark?: boolean;
}) {
  if (format === 'telegram') {
    return <BrandIcon id="telegram" size={size} tile onDark={onDark} />;
  }
  if (format === 'discord') {
    return <BrandIcon id="discord" size={size} tile onDark={onDark} />;
  }
  if (format === 'google_sheets') {
    return <BrandIcon id="google-sheets" size={size} tile onDark={onDark} />;
  }

  const boxSize = Math.max(size + 12, 28);
  if (format === 'sepay') {
    return (
      <span
        style={{ width: boxSize, height: boxSize }}
        className={`cm-icon-tile ${onDark ? 'bg-white border-white/20' : 'bg-[#ECFDF5] border-[#A7F3D0]'}`}
      >
        <PlugsConnected size={size} weight="duotone" className="text-[#047857]" />
      </span>
    );
  }
  if (format === 'payos') {
    return (
      <span
        style={{ width: boxSize, height: boxSize }}
        className={`cm-icon-tile ${onDark ? 'bg-white border-white/20' : 'bg-amber-50 border-amber-200'}`}
      >
        <ShieldCheck size={size} weight="duotone" className="text-amber-700" />
      </span>
    );
  }

  return (
    <span
      style={{ width: boxSize, height: boxSize }}
      className={`cm-icon-tile ${onDark ? 'bg-white border-white/20' : 'bg-white border-black/[0.08]'}`}
    >
      <ComeyMark size={Math.max(size + 2, 18)} />
    </span>
  );
}
