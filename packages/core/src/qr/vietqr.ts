export interface VietQRInput {
  bankBin: string;
  accountNumber: string;
  amount?: number;
  transferNote?: string;
}

export function sanitizeTransferNote(note: string, maxLen = 50): string {
  return String(note || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function formatTLV(tag: string, value: string): string {
  const strVal = String(value);
  const length = String(strVal.length).padStart(2, '0');
  return `${tag}${length}${strVal}`;
}

const textEncoder = new TextEncoder();

function calculateCRC16CCITT(str: string): string {
  let crc = 0xffff;
  const bytes = textEncoder.encode(str);
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function generateVietQREMVCo(input: VietQRInput): string {
  const bankBin = String(input.bankBin || '').trim();
  const accountNumber = String(input.accountNumber || '').trim();
  if (!bankBin) throw new Error('bankBin is required');
  if (!accountNumber) throw new Error('accountNumber is required');

  const amount =
    input.amount !== undefined && Number.isFinite(input.amount) && input.amount > 0
      ? Math.floor(input.amount)
      : 0;

  let payload = formatTLV('00', '01');
  payload += formatTLV('01', amount > 0 ? '12' : '11');

  const merchantAcct =
    formatTLV('00', 'A000000727') +
    formatTLV('01', formatTLV('00', bankBin) + formatTLV('01', accountNumber)) +
    formatTLV('02', 'QRIBFTTA');

  payload += formatTLV('38', merchantAcct);
  payload += formatTLV('53', '704');

  if (amount > 0) {
    payload += formatTLV('54', String(amount));
  }

  payload += formatTLV('58', 'VN');

  const safeTransferNote = sanitizeTransferNote(input.transferNote || '');
  if (safeTransferNote) {
    payload += formatTLV('62', formatTLV('08', safeTransferNote));
  }

  payload += '6304';
  payload += calculateCRC16CCITT(payload);
  return payload;
}
