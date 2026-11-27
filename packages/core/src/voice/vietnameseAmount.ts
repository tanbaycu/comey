/**
 * Pure Web Standards converter from VND integers to natural spoken Vietnamese
 * for Soundbox voice announcements ("Loa thông báo chuyển khoản").
 */

const DIGITS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
] as const;

const SUB_SCALES = ['', 'nghìn', 'triệu'] as const;
const VI_NUMBER_FORMAT = new Intl.NumberFormat('vi-VN');

function digitWord(n: number): string {
  return DIGITS[n] ?? '';
}

function readThreeDigits(group: number, hasHigherGroup: boolean): string {
  if (group === 0) {
    return '';
  }

  const hundreds = Math.floor(group / 100);
  const remainder = group % 100;
  const tens = Math.floor(remainder / 10);
  const ones = remainder % 10;

  const parts: string[] = [];

  if (hundreds > 0 || hasHigherGroup) {
    parts.push(`${digitWord(hundreds)} trăm`);
  }

  if (tens === 0) {
    if (ones > 0) {
      if (hundreds > 0 || hasHigherGroup) {
        parts.push(`linh ${digitWord(ones)}`);
      } else {
        parts.push(digitWord(ones));
      }
    }
  } else if (tens === 1) {
    parts.push('mười');
    if (ones === 5) {
      parts.push('lăm');
    } else if (ones > 0) {
      parts.push(digitWord(ones));
    }
  } else {
    parts.push(`${digitWord(tens)} mươi`);
    if (ones === 1) {
      parts.push('mốt');
    } else if (ones === 5) {
      parts.push('lăm');
    } else if (ones > 0) {
      parts.push(digitWord(ones));
    }
  }

  return parts.join(' ');
}

function groupScaleUnit(groupIndex: number): string {
  if (groupIndex === 0) {
    return '';
  }
  const mod = groupIndex % 3;
  if (mod === 0) {
    const tyRepeat = Math.floor(groupIndex / 3);
    return tyRepeat <= 1 ? 'tỷ' : Array.from({ length: tyRepeat }, () => 'tỷ').join(' ');
  }
  return SUB_SCALES[mod] ?? '';
}

/**
 * Convert an integer amount in VND into spoken Vietnamese words.
 * Examples:
 * - 0 -> "không"
 * - 80000 -> "tám mươi nghìn"
 * - 1050000 -> "một triệu không trăm năm mươi nghìn"
 * - 1005000000000 -> "một nghìn không trăm linh năm tỷ"
 */
export function vndToVietnameseWords(amount: number): string {
  if (!Number.isFinite(amount)) {
    return 'không';
  }

  const rounded = Math.trunc(amount);
  if (rounded === 0) {
    return 'không';
  }

  const isNegative = rounded < 0;
  let remaining = Math.abs(rounded);
  const groups: number[] = [];

  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts: string[] = [];
  let blockHasValue = false;

  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const groupValue = groups[i] ?? 0;
    const mod = i % 3;

    if (groupValue > 0) {
      blockHasValue = true;
      const hasHigherGroup = i < groups.length - 1;
      const words = readThreeDigits(groupValue, hasHigherGroup);
      if (words) {
        const subScale = mod === 0 ? '' : groupScaleUnit(i);
        parts.push(subScale ? `${words} ${subScale}` : words);
      }
    }

    if (mod === 0) {
      if (i > 0 && blockHasValue) {
        parts.push(groupScaleUnit(i));
      }
      blockHasValue = false;
    }
  }

  const joined = parts.join(' ').trim() || 'không';
  return isNegative ? `âm ${joined}` : joined;
}

export interface SoundboxSpeechOptions {
  amount: number;
  currency?: string;
  content?: string;
  senderName?: string;
  template?: string;
}

/**
 * Build the natural Vietnamese announcement spoken by the Web/IoT Soundbox.
 */
export function formatSoundboxSpeech(options: SoundboxSpeechOptions): string {
  const currency = (options.currency ?? 'VND').toUpperCase();
  const amountWords = vndToVietnameseWords(options.amount);
  const currencyUnit = currency === 'VND' ? 'đồng' : currency;

  if (!options.template || !options.template.trim()) {
    return `Đã nhận ${amountWords} ${currencyUnit}`.trim();
  }

  const formattedAmount = VI_NUMBER_FORMAT.format(options.amount);
  return options.template
    .replaceAll('{amountWords}', amountWords)
    .replaceAll('{amountFormatted}', formattedAmount)
    .replaceAll('{amount}', String(options.amount))
    .replaceAll('{currency}', currencyUnit)
    .replaceAll('{content}', (options.content ?? '').trim())
    .replaceAll('{senderName}', (options.senderName ?? '').trim())
    .replace(/\s+/g, ' ')
    .trim();
}
