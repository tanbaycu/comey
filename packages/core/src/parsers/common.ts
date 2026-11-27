export const MAX_VND_AMOUNT = 10_000_000_000;

const STRICT_SIGNED_VND_RE =
  /^\+\s*(?:(\d{1,3}(?:\.\d{3})+)(?:,00)?|(\d{1,3}(?:,\d{3})+)(?:\.00)?|(\d+)(?:[.,]00)?)(?:\s*(?:đ|₫|vnd)(?=$|[\s(,;.])|(?=$|[\s(]))/i;

const STRICT_UNSIGNED_OR_SIGNED_VND_RE =
  /^(?:(?:\+|(?:ghi\s+c[oó]|t[ăa]ng|c[ộo]ng)\s*\+?)\s*)?(?:(\d{1,3}(?:\.\d{3})+)(?:,00)?|(\d{1,3}(?:,\d{3})+)(?:\.00)?|(\d+)(?:[.,]00)?)(?:\s*(?:đ|₫|vnd)(?=$|[\s(,;.])|(?=$|[\s(]))/i;

const OUTGOING_AMOUNT_RE =
  /^(?:-|ghi\s+n[ơợ]|gi[ảa]m|tr[ừu]\b)/i;

const ACCOUNT_TOKEN_RE =
  /(?<![A-Za-z0-9])([0-9*xX](?:[0-9*xX]|[\s-](?=[0-9*xX]))*)(?![A-Za-z0-9])/g;

export function isOutgoingAmountText(amountRaw: string): boolean {
  return OUTGOING_AMOUNT_RE.test(String(amountRaw || '').trim());
}

/**
 * Strictly parse an incoming VND amount string without concatenating trailing numbers
 * (e.g. "+50.000 đ (Phí: 0 đ)" -> 50000, "+50.000,00 VND" -> 50000).
 */
export function parseStrictIncomingVndAmount(
  amountRaw: string,
  options?: { allowUnsignedPositive?: boolean }
): number | null {
  const trimmed = String(amountRaw || '').trim();
  if (!trimmed || isOutgoingAmountText(trimmed)) {
    return null;
  }

  const re = options?.allowUnsignedPositive
    ? STRICT_UNSIGNED_OR_SIGNED_VND_RE
    : STRICT_SIGNED_VND_RE;
  const match = re.exec(trimmed);
  if (!match) return null;

  const numGroup = match[1] ?? match[2] ?? match[3];
  if (!numGroup) return null;

  const digits = numGroup.replace(/[.,]/g, '');
  if (!digits || digits.length > 15) return null;

  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_VND_AMOUNT) {
    return null;
  }
  return parsed;
}

export function extractAccountToken(receiverRaw: string): string {
  const raw = String(receiverRaw || '');
  ACCOUNT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACCOUNT_TOKEN_RE.exec(raw)) !== null) {
    const candidate = (m[1] || '').replace(/[\s-]/g, '');
    if (/\d/.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesAccountNumber(
  receiverToken: string,
  expectedDigits: string
): boolean {
  if (!receiverToken || !expectedDigits) return false;
  if (!/[*xX]/.test(receiverToken)) {
    return receiverToken === expectedDigits;
  }

  const visibleDigits = receiverToken.replace(/[^0-9]/g, '');
  const minVisible = Math.min(4, expectedDigits.length);
  if (visibleDigits.length < minVisible || visibleDigits.length >= expectedDigits.length) {
    return false;
  }

  const pattern = receiverToken
    .split(/[*xX]+/)
    .map((part) => escapeRegExp(part))
    .join('\\d+');
  return new RegExp(`^${pattern}$`).test(expectedDigits);
}

export function buildDeterministicTxId(
  bankCode: string,
  amount: number,
  occurredAt: string,
  content: string
): string {
  const seed = `${bankCode.toUpperCase()}|${amount}|${occurredAt}|${content}`;
  let h1 = 2166136261;
  let h2 = 33554467;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 16777619);
    h2 ^= code;
    h2 = Math.imul(h2, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return `FT${bankCode.toUpperCase().slice(0, 4)}${hex1}${hex2}`;
}
