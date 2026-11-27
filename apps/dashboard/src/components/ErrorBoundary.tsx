import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'Đã xảy ra lỗi hiển thị không mong muốn',
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Comey Dashboard ErrorBoundary:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F6F7F5] p-6">
          <div className="max-w-md w-full rounded-2xl bg-white border border-black/10 p-7 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-extrabold text-[#121417]">
              Giao diện gặp sự cố tạm thời
            </h1>
            <p className="text-sm text-[#525866] leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="comey-btn comey-btn-dark w-full inline-flex items-center justify-center gap-2 text-sm px-4"
            >
              <RotateCcw className="w-4 h-4" /> Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
