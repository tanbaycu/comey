export function formatVnd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.floor(amount) : 0;
  return `${safe.toLocaleString('vi-VN')} đ`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelativeExpiry(iso?: string | null, nowMs = Date.now()): string {
  if (!iso) return '—';
  const diffMs = Date.parse(iso) - nowMs;
  if (!Number.isFinite(diffMs)) return '—';
  if (diffMs <= 0) return 'Đã hết hạn';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Còn ${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `Còn ${hours}h ${mins}m`;
  return `Còn ${Math.max(1, mins)} phút`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
