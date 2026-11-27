import { CheckCircle } from '@phosphor-icons/react';
import { Search } from 'lucide-react';
import { useState } from 'react';
import type { BankCatalogItem } from '../lib/types';

export interface BankMeta {
  code: string;
  short: string;
  name: string;
  bin: string;
  logoPath: string;
  accent: string;
  softBg: string;
  borderColor: string;
}

const BANK_META_MAP: Record<string, BankMeta> = {
  CAKE: {
    code: 'CAKE',
    short: 'CAKE',
    name: 'Cake by VPBank',
    bin: '546034',
    logoPath: '/assets/banks/CAKE.png',
    accent: '#047857',
    softBg: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  MB: {
    code: 'MB',
    short: 'MB',
    name: 'MB Bank',
    bin: '970422',
    logoPath: '/assets/banks/MB.png',
    accent: '#1D4ED8',
    softBg: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  VCB: {
    code: 'VCB',
    short: 'VCB',
    name: 'Vietcombank',
    bin: '970436',
    logoPath: '/assets/banks/VCB.png',
    accent: '#15803D',
    softBg: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  TECHCOMBANK: {
    code: 'TECHCOMBANK',
    short: 'TCB',
    name: 'Techcombank',
    bin: '970407',
    logoPath: '/assets/banks/TCB.png',
    accent: '#DC2626',
    softBg: '#FEF2F2',
    borderColor: '#FECACA',
  },
  TIMO: {
    code: 'TIMO',
    short: 'TIMO',
    name: 'Timo by BVBank',
    bin: '963388',
    logoPath: '/assets/banks/TIMO.png',
    accent: '#B45309',
    softBg: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  ACB: {
    code: 'ACB',
    short: 'ACB',
    name: 'Ngân hàng ACB',
    bin: '970416',
    logoPath: '/assets/banks/ACB.png',
    accent: '#0369A1',
    softBg: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  SACOMBANK: {
    code: 'SACOMBANK',
    short: 'STB',
    name: 'Sacombank',
    bin: '970403',
    logoPath: '/assets/banks/STB.png',
    accent: '#0369A1',
    softBg: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  TPBANK: {
    code: 'TPBANK',
    short: 'TPB',
    name: 'TPBank',
    bin: '970423',
    logoPath: '/assets/banks/TPB.png',
    accent: '#D97706',
    softBg: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  VIB: {
    code: 'VIB',
    short: 'VIB',
    name: 'VIB',
    bin: '970441',
    logoPath: '/assets/banks/VIB.png',
    accent: '#1D4ED8',
    softBg: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  VPBANK: {
    code: 'VPBANK',
    short: 'VPB',
    name: 'VPBank',
    bin: '970432',
    logoPath: '/assets/banks/VPB.png',
    accent: '#047857',
    softBg: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  BIDV: {
    code: 'BIDV',
    short: 'BIDV',
    name: 'BIDV',
    bin: '970418',
    logoPath: '/assets/banks/BIDV.png',
    accent: '#0F766E',
    softBg: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  VIETINBANK: {
    code: 'VIETINBANK',
    short: 'CTG',
    name: 'VietinBank',
    bin: '970415',
    logoPath: '/assets/banks/ICB.png',
    accent: '#0284C7',
    softBg: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
};

export const BANK_CODES_ALL = [
  'CAKE',
  'MB',
  'VCB',
  'TECHCOMBANK',
  'TIMO',
  'ACB',
  'SACOMBANK',
  'TPBANK',
  'VIB',
  'VPBANK',
  'BIDV',
  'VIETINBANK',
] as const;

export const FALLBACK_BANKS: BankCatalogItem[] = BANK_CODES_ALL.map((code) => {
  const b = BANK_META_MAP[code]!;
  return {
    code: b.code,
    bin: b.bin,
    name: b.name,
    shortName: b.short,
    color: b.accent,
    logoUrl: b.logoPath,
    emailDomains: [],
    dkimDomains: [],
  };
});

export function getBankMeta(code: string): BankMeta {
  const key = (code || '').toUpperCase();
  return (
    BANK_META_MAP[key] ?? {
      code: key || 'BANK',
      short: (key || 'BK').slice(0, 4),
      name: key || 'Ngân hàng',
      bin: '',
      logoPath: '',
      accent: '#09090B',
      softBg: '#F4F4F5',
      borderColor: 'rgba(9, 9, 11, 0.12)',
    }
  );
}

export function BankLogo({
  code,
  size = 'md',
  plate = true,
  className = '',
}: {
  code: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'card';
  plate?: boolean;
  className?: string;
}) {
  const meta = getBankMeta(code);
  const [errored, setErrored] = useState(false);

  const boxCls =
    size === 'xs'
      ? 'h-6 w-11 px-1 py-0.5 rounded-[5px]'
      : size === 'sm'
        ? 'h-7 w-14 px-1.5 py-0.5 rounded-[6px]'
        : size === 'lg'
          ? 'h-10 w-24 px-2 py-1 rounded-[8px]'
          : size === 'card'
            ? 'h-9 w-full px-2.5 py-1.5 rounded-[7px]'
            : 'h-8 w-20 px-2 py-1 rounded-[7px]';

  if (errored || !meta.logoPath) {
    return (
      <span
        style={{
          backgroundColor: meta.softBg,
          borderColor: meta.borderColor,
          color: meta.accent,
        }}
        className={`inline-flex items-center justify-center border font-mono-num text-[11px] font-bold shrink-0 ${boxCls} ${className}`.trim()}
      >
        {meta.short}
      </span>
    );
  }

  return (
    <span
      className={`${plate ? 'cm-bank-plate' : 'inline-flex items-center justify-center shrink-0'} ${boxCls} ${className}`.trim()}
      title={meta.name}
    >
      <img
        src={meta.logoPath}
        alt={meta.name}
        loading="eager"
        decoding="sync"
        onError={() => setErrored(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export function BankEmblem({
  code,
  size = 'md',
  className = '',
}: {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const logoSize = size === 'lg' ? 'lg' : size === 'sm' ? 'xs' : 'sm';

  return (
    <span className={`inline-flex items-center gap-1.5 shrink-0 ${className}`.trim()}>
      <BankLogo code={code} size={logoSize} />
    </span>
  );
}

export function BankTilePicker({
  banks,
  value,
  onChange,
}: {
  banks: BankCatalogItem[];
  value: string;
  onChange: (nextCode: string) => void;
}) {
  const [search, setSearch] = useState('');
  const list = banks.length > 0 ? banks : FALLBACK_BANKS;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? list.filter((b) => {
        const meta = getBankMeta(b.code);
        return (
          meta.name.toLowerCase().includes(q) ||
          meta.short.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q)
        );
      })
    : list;

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search
          className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm ngân hàng: Cake, MB, Vietcombank, BIDV..."
          aria-label="Tìm ngân hàng phát hành"
          className="cm-input pl-8 h-9 text-[12.5px]"
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Chọn ngân hàng phát hành"
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5"
      >
        {filtered.map((b) => {
          const active = value === b.code;
          const meta = getBankMeta(b.code);
          return (
            <button
              key={b.code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(b.code)}
              className={`relative rounded-[10px] border p-2.5 text-left cursor-pointer transition-[border-color,background-color] duration-150 ${
                active
                  ? 'border-[#09090B] bg-[#09090B] text-white'
                  : 'border-black/[0.08] bg-white hover:bg-[#F5F6F7] text-[#09090B]'
              }`}
            >
              <div className="mb-2">
                <BankLogo code={b.code} size="card" />
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={`text-[12px] font-semibold leading-tight truncate ${
                    active ? 'text-white' : 'text-[#09090B]'
                  }`}
                >
                  {meta.name}
                </span>
                {active && (
                  <CheckCircle size={14} weight="fill" className="text-[#34D399] shrink-0" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
