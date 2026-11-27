const MONOGRAM_SWATCHES = [
  { bg: '#ECFDF5', ink: '#047857', border: '#A7F3D0' },
  { bg: '#F4F4F5', ink: '#09090B', border: 'rgba(9,9,11,0.12)' },
  { bg: '#EFF6FF', ink: '#1D4ED8', border: '#BFDBFE' },
  { bg: '#FFFBEB', ink: '#B45309', border: '#FDE68A' },
];

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function buildInitials(nameOrSeed: string): string {
  const cleaned = (nameOrSeed || 'CM').trim();
  const words = cleaned.split(/[\s@._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] || ''}${words[1]![0] || ''}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase() || 'CM';
}

const SIZE_PX: Record<'xs' | 'sm' | 'md' | 'lg', number> = {
  xs: 22,
  sm: 32,
  md: 40,
  lg: 52,
};

export function IdentityAvatar({
  seed,
  name,
  size = 'sm',
  ring = 'none',
  className = '',
}: {
  seed: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ring?: 'none' | 'live' | 'obsidian';
  className?: string;
}) {
  const normalizedSeed = (seed || name || 'comey').trim();
  const px = SIZE_PX[size];
  const swatch = MONOGRAM_SWATCHES[hashSeed(normalizedSeed) % MONOGRAM_SWATCHES.length]!;
  const initials = buildInitials(name || normalizedSeed);

  const fontCls =
    size === 'xs'
      ? 'text-[9.5px]'
      : size === 'sm'
        ? 'text-[11px]'
        : size === 'lg'
          ? 'text-[15px]'
          : 'text-[13px]';

  const ringCls =
    ring === 'live'
      ? 'ring-2 ring-[#047857]/30 ring-offset-1 ring-offset-white'
      : ring === 'obsidian'
        ? 'ring-2 ring-[#09090B]/20 ring-offset-1 ring-offset-white'
        : '';

  return (
    <span
      aria-hidden="true"
      style={{
        width: px,
        height: px,
        backgroundColor: swatch.bg,
        color: swatch.ink,
        borderColor: swatch.border,
      }}
      className={`inline-flex items-center justify-center rounded-full border font-mono-num font-semibold shrink-0 select-none ${fontCls} ${ringCls} ${className}`.trim()}
    >
      {initials}
    </span>
  );
}
