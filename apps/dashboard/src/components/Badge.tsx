const TONE_CLASSES: Record<string, string> = {
  green: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
  amber: 'bg-amber-50/90 text-amber-800 border-amber-200/80',
  rose: 'bg-rose-50/90 text-rose-700 border-rose-200/80',
  slate: 'bg-[#F4F4F5] text-[#52525B] border-black/[0.08]',
  blue: 'bg-sky-50/90 text-sky-700 border-sky-200/80',
  lime: 'bg-[#09090B] text-white border-[#09090B]',
};

export function Badge({
  tone = 'slate',
  className = '',
  children,
}: {
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11.5px] font-medium leading-tight tracking-[-0.005em] ${
        TONE_CLASSES[tone] ?? TONE_CLASSES.slate
      } ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof TONE_CLASSES {
  switch (status) {
    case 'paid':
    case 'delivered':
    case 'verified':
      return 'green';
    case 'underpaid':
    case 'overpaid_review':
    case 'retrying':
    case 'pending':
    case 'confirmation_received':
      return 'amber';
    case 'expired':
    case 'failed':
    case 'spoof_suspected':
      return 'rose';
    default:
      return 'slate';
  }
}
