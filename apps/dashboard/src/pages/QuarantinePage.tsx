import { ShieldCheck as PhShieldCheck } from '@phosphor-icons/react';
import { Check, Eye, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, statusTone } from '../components/Badge';
import { BankEmblem } from '../components/BankEmblem';
import { EmptyState } from '../components/EmptyState';
import { SheetDrawer } from '../components/SheetDrawer';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatRelativeExpiry } from '../lib/format';
import type { QuarantineItem } from '../lib/types';

export function QuarantinePage({
  quarantine,
  onReload,
  onNotify,
}: {
  quarantine: QuarantineItem[];
  onReload: () => Promise<void>;
  onNotify: (kind: 'success' | 'error', text: string) => void;
}) {
  const [inspectItem, setInspectItem] = useState<QuarantineItem | null>(null);

  async function handleDismiss(id: string) {
    try {
      await api.quarantine.dismiss(id);
      setInspectItem(null);
      await onReload();
      onNotify('success', 'Đã đánh dấu xử lý');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi thao tác');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.quarantine.remove(id);
      setInspectItem(null);
      await onReload();
      onNotify('success', 'Đã xóa vĩnh viễn khỏi Hộp cách ly');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Lỗi xóa');
    }
  }

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#09090B]">
          Hộp cách ly bảo mật
        </h2>
        <p className="text-[13px] text-[#71717A] mt-0.5 max-w-2xl">
          Email không đạt xác thực DKIM ngân hàng hoặc có cấu trúc bất thường được giữ tạm tối đa
          72 giờ trước khi tự động xóa, đảm bảo không ghi nhận nhầm giao dịch.
        </p>
      </div>

      <div className="cm-panel overflow-hidden min-w-0">
        {quarantine.length === 0 ? (
          <EmptyState
            icon={PhShieldCheck}
            title="Hộp cách ly đang trống"
            description="Toàn bộ email biến động số dư hợp lệ đã được bóc tách và tự động hủy nội dung thô ngay sau khi xử lý."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#FAFAFA] text-[#71717A] text-[12px] font-medium border-b border-black/[0.06]">
                <tr>
                  <th className="px-4 py-2.5">Tiêu đề &amp; Lý do</th>
                  <th className="px-4 py-2.5">Người gửi</th>
                  <th className="px-4 py-2.5">Trạng thái</th>
                  <th className="px-4 py-2.5">Tự xóa sau</th>
                  <th className="px-4 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {quarantine.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setInspectItem(q)}
                    className="hover:bg-[#FAFAFA] transition-colors duration-100 cursor-pointer"
                  >
                    <td className="px-4 py-3 space-y-0.5 max-w-sm">
                      <div className="font-medium text-[#09090B] truncate">
                        {q.subject || '(Không có tiêu đề)'}
                      </div>
                      <div className="text-[12px] text-[#DC2626] truncate">{q.reason}</div>
                    </td>
                    <td className="px-4 py-3 font-mono-num text-[12.5px] text-[#52525B]">
                      <div>{q.sender}</div>
                      <div className="text-[11px] text-[#71717A]">{formatDateTime(q.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone(q.authStatus)}>{q.authStatus}</Badge>
                        {q.bankCode && <BankEmblem code={q.bankCode} size="sm" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="amber">{formatRelativeExpiry(q.expiresAt)}</Badge>
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectItem(q)}
                          className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                        >
                          <Eye className="w-3.5 h-3.5" /> Kiểm tra
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDismiss(q.id)}
                          className="cm-btn cm-btn-secondary h-8 px-2.5 text-[12px]"
                        >
                          <Check className="w-3.5 h-3.5" /> Bỏ qua
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(q.id)}
                          className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-[6px] text-[#71717A] hover:text-[#DC2626] hover:bg-rose-50 cursor-pointer"
                          aria-label="Xóa thư cách ly"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SheetDrawer
        open={Boolean(inspectItem)}
        onClose={() => setInspectItem(null)}
        size="lg"
        title="Nội dung email cách ly"
        subtitle={inspectItem ? inspectItem.sender : ''}
        footer={
          inspectItem && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleDismiss(inspectItem.id)}
                className="cm-btn cm-btn-secondary"
              >
                <Check className="w-3.5 h-3.5" /> Đánh dấu bỏ qua
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(inspectItem.id)}
                className="cm-btn cm-btn-danger"
              >
                <Trash2 className="w-3.5 h-3.5" /> Xóa ngay
              </button>
            </div>
          )
        }
      >
        {inspectItem && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(inspectItem.authStatus)}>{inspectItem.authStatus}</Badge>
              {inspectItem.bankCode && <BankEmblem code={inspectItem.bankCode} size="sm" />}
              <Badge tone="amber">{formatRelativeExpiry(inspectItem.expiresAt)}</Badge>
            </div>

            <div className="rounded-[8px] border border-rose-200 bg-rose-50/80 p-3.5 text-[12.5px] text-[#DC2626] font-medium">
              Lý do giữ lại: {inspectItem.reason}
            </div>

            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-[#71717A]">
                Trích xuất nội dung thô (tối đa 512 ký tự)
              </div>
              <pre className="rounded-[8px] bg-[#09090B] text-zinc-200 p-4 text-[12px] font-mono-num whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                {inspectItem.rawSnippet || '(Không có nội dung trích xuất)'}
              </pre>
            </div>
          </div>
        )}
      </SheetDrawer>
    </div>
  );
}
