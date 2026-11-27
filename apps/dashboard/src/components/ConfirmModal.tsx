import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Xác nhận',
  destructive = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ transition: 'opacity 180ms var(--ease-out)' }}
      className={`fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        style={{
          transition: 'transform 190ms var(--ease-out), opacity 190ms var(--ease-out)',
        }}
        className={`w-full max-w-[420px] rounded-[12px] bg-white border border-black/[0.08] p-5 shadow-2xl space-y-4 transform ${
          visible ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-[8px] flex items-center justify-center shrink-0 ${
                destructive
                  ? 'bg-rose-50 text-[#DC2626] border border-rose-200/70'
                  : 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3
                id="confirm-modal-title"
                className="text-[15px] font-semibold tracking-[-0.015em] text-[#09090B]"
              >
                {title}
              </h3>
              <p className="mt-1 text-[13px] text-[#52525B] leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-[7px] text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5] cursor-pointer shrink-0 transition-colors duration-150"
            aria-label="Đóng hộp thoại"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/[0.06]">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="cm-btn cm-btn-secondary"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className={`cm-btn ${destructive ? 'cm-btn-danger' : 'cm-btn-primary'}`}
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
