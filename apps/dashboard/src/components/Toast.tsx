import { Toaster, toast } from 'sonner';
import 'sonner/dist/styles.css';

export interface ToastMessage {
  id: string;
  kind: 'success' | 'error';
  text: string;
}

export function notifyToast(kind: 'success' | 'error', text: string): void {
  if (kind === 'success') {
    toast.success(text);
  } else {
    toast.error(text);
  }
}

export function ComeyToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        style: {
          fontFamily: 'var(--font-sans)',
          borderRadius: '10px',
          fontSize: '13px',
        },
      }}
    />
  );
}
