import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface PillRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const prevIdxRef = useRef<number | null>(null);
  const [pill, setPill] = useState<PillRect | null>(null);
  const [animate, setAnimate] = useState(false);

  const activeIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const optionsSignature = options.map((o) => `${o.value}:${o.label}:${o.count ?? ''}`).join('|');

  const measure = useCallback(
    (shouldAnimate: boolean) => {
      const btn = btnRefs.current[activeIdx];
      if (!btn || btn.offsetWidth <= 0 || btn.offsetHeight <= 0) return;
      const next: PillRect = {
        left: btn.offsetLeft,
        top: btn.offsetTop,
        width: btn.offsetWidth,
        height: btn.offsetHeight,
      };
      setAnimate(shouldAnimate);
      setPill((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      );
    },
    [activeIdx]
  );

  useLayoutEffect(() => {
    const idxChanged = prevIdxRef.current !== null && prevIdxRef.current !== activeIdx;
    prevIdxRef.current = activeIdx;
    measure(idxChanged);
  }, [activeIdx, measure, optionsSignature, size, fullWidth]);

  useEffect(() => {
    const container = containerRef.current;
    const activeBtn = btnRefs.current[activeIdx];
    const snap = () => measure(false);

    let obs: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      obs = new ResizeObserver(snap);
      if (container) obs.observe(container);
      if (activeBtn) obs.observe(activeBtn);
    }

    let cancelled = false;
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) snap();
      });
    }

    return () => {
      cancelled = true;
      obs?.disconnect();
    };
  }, [activeIdx, measure, optionsSignature]);

  const padCls = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[12.5px]';

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = options[(idx + 1) % options.length];
      if (next) onChange(next.value);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = options[(idx - 1 + options.length) % options.length];
      if (prev) onChange(prev.value);
    }
  }

  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      style={
        fullWidth
          ? { gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }
          : undefined
      }
      className={`relative rounded-[8px] bg-[#F4F4F5] p-[3px] border border-black/[0.06] ${
        fullWidth ? 'grid w-full' : 'inline-flex max-w-full flex-wrap items-center'
      } ${className}`.trim()}
    >
      {pill && (
        <span
          aria-hidden="true"
          style={{
            width: `${pill.width}px`,
            height: `${pill.height}px`,
            transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
            transition:
              animate && !reducedMotion
                ? 'transform 220ms var(--ease-out), width 220ms var(--ease-out), height 220ms var(--ease-out)'
                : 'none',
          }}
          className="pointer-events-none absolute top-0 left-0 z-0 rounded-[6px] bg-white shadow-[0_1px_2px_rgba(9,9,11,0.08)] ring-1 ring-black/[0.04]"
        />
      )}

      {options.map((opt, idx) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 inline-flex items-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 ${padCls} ${
              fullWidth ? 'w-full justify-center' : ''
            } ${
              isActive
                ? `text-[#09090B] ${!pill ? 'bg-white shadow-[0_1px_2px_rgba(9,9,11,0.08)]' : ''}`
                : 'text-[#52525B] hover:text-[#09090B]'
            }`}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`font-mono-num text-[11px] ${
                  isActive ? 'text-[#52525B]' : 'text-[#71717A]'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
