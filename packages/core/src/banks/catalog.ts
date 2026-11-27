import type { BankCode, BankMetadata } from '../types.js';

const VIETQR_CDN_BASE = 'https://cdn.vietqr.io/img';

export const BANK_CATALOG: Record<
  | 'CAKE'
  | 'SACOMBANK'
  | 'TIMO'
  | 'TPBANK'
  | 'TECHCOMBANK'
  | 'VIB'
  | 'MB'
  | 'ACB'
  | 'VCB'
  | 'VPBANK'
  | 'BIDV'
  | 'VIETINBANK',
  BankMetadata
> = {
  CAKE: {
    code: 'CAKE',
    bin: '546034',
    name: 'Cake by VPBank',
    shortName: 'Cake',
    color: '#D91A6B',
    logoUrl: `${VIETQR_CDN_BASE}/CAKE.png`,
    emailDomains: ['cake.vn'],
    dkimDomains: ['cake.vn'],
  },
  SACOMBANK: {
    code: 'SACOMBANK',
    bin: '970403',
    name: 'Sacombank',
    shortName: 'Sacombank',
    color: '#0056A3',
    logoUrl: `${VIETQR_CDN_BASE}/STB.png`,
    emailDomains: ['sacombank.com.vn'],
    dkimDomains: ['sacombank.com.vn'],
  },
  TIMO: {
    code: 'TIMO',
    bin: '963388',
    name: 'Timo by BVBank',
    shortName: 'Timo',
    color: '#5B2D90',
    logoUrl: `${VIETQR_CDN_BASE}/TIMO.png`,
    emailDomains: ['timo.vn'],
    dkimDomains: ['timo.vn'],
  },
  TPBANK: {
    code: 'TPBANK',
    bin: '970423',
    name: 'TPBank',
    shortName: 'TPBank',
    color: '#6D28D9',
    logoUrl: `${VIETQR_CDN_BASE}/TPB.png`,
    emailDomains: ['tpb.com.vn'],
    dkimDomains: ['tpb.com.vn'],
  },
  TECHCOMBANK: {
    code: 'TECHCOMBANK',
    bin: '970407',
    name: 'Techcombank',
    shortName: 'Techcombank',
    color: '#E11D48',
    logoUrl: `${VIETQR_CDN_BASE}/TCB.png`,
    emailDomains: ['techcombank.com.vn'],
    dkimDomains: ['techcombank.com.vn'],
  },
  VIB: {
    code: 'VIB',
    bin: '970441',
    name: 'VIB',
    shortName: 'VIB',
    color: '#F59E0B',
    logoUrl: `${VIETQR_CDN_BASE}/VIB.png`,
    emailDomains: ['vib.com.vn'],
    dkimDomains: ['vib.com.vn'],
  },
  MB: {
    code: 'MB',
    bin: '970422',
    name: 'MB Bank',
    shortName: 'MB',
    color: '#1D4ED8',
    logoUrl: `${VIETQR_CDN_BASE}/MB.png`,
    emailDomains: ['mbbank.com.vn'],
    dkimDomains: ['mbbank.com.vn'],
  },
  ACB: {
    code: 'ACB',
    bin: '970416',
    name: 'ACB',
    shortName: 'ACB',
    color: '#0284C7',
    logoUrl: `${VIETQR_CDN_BASE}/ACB.png`,
    emailDomains: ['acb.com.vn'],
    dkimDomains: ['acb.com.vn'],
  },
  VCB: {
    code: 'VCB',
    bin: '970436',
    name: 'Vietcombank',
    shortName: 'VCB',
    color: '#15803D',
    logoUrl: `${VIETQR_CDN_BASE}/VCB.png`,
    emailDomains: ['vietcombank.com.vn'],
    dkimDomains: ['vietcombank.com.vn'],
  },
  VPBANK: {
    code: 'VPBANK',
    bin: '970432',
    name: 'VPBank',
    shortName: 'VPBank',
    color: '#16A34A',
    logoUrl: `${VIETQR_CDN_BASE}/VPB.png`,
    emailDomains: ['vpbank.com.vn'],
    dkimDomains: ['vpbank.com.vn'],
  },
  BIDV: {
    code: 'BIDV',
    bin: '970418',
    name: 'BIDV',
    shortName: 'BIDV',
    color: '#0F766E',
    logoUrl: `${VIETQR_CDN_BASE}/BIDV.png`,
    emailDomains: ['bidv.com.vn'],
    dkimDomains: ['bidv.com.vn'],
  },
  VIETINBANK: {
    code: 'VIETINBANK',
    bin: '970415',
    name: 'VietinBank',
    shortName: 'VietinBank',
    color: '#0369A1',
    logoUrl: `${VIETQR_CDN_BASE}/ICB.png`,
    emailDomains: ['vietinbank.vn'],
    dkimDomains: ['vietinbank.vn'],
  },
};

const ALIAS_MAP: Record<string, keyof typeof BANK_CATALOG> = {
  STB: 'SACOMBANK',
  TPB: 'TPBANK',
  TCB: 'TECHCOMBANK',
  MBB: 'MB',
  VCB: 'VCB',
  VIETCOMBANK: 'VCB',
  VPB: 'VPBANK',
  ICB: 'VIETINBANK',
};

export function getBankMetadata(codeOrBin: BankCode | string): BankMetadata | undefined {
  const normalized = String(codeOrBin || '')
    .trim()
    .toUpperCase();
  if (!normalized) return undefined;

  if (normalized in BANK_CATALOG) {
    return BANK_CATALOG[normalized as keyof typeof BANK_CATALOG];
  }
  if (normalized in ALIAS_MAP) {
    return BANK_CATALOG[ALIAS_MAP[normalized]!];
  }
  return Object.values(BANK_CATALOG).find((bank) => bank.bin === normalized);
}

export function listSupportedBanks(): BankMetadata[] {
  return Object.values(BANK_CATALOG);
}
