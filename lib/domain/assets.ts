import type { Asset, AssetType, InvestmentAction } from '@/lib/db/schema';

/** Asset kinds, their display groups and defaults (PLAN section 5). */

export const ASSET_TYPES = [
  'mutual_fund',
  'stock',
  'etf',
  'gold',
  'fixed_deposit',
  'bond',
  'ppf',
  'epf',
  'nps',
  'other',
] as const satisfies readonly AssetType[];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  mutual_fund: 'Mutual fund',
  stock: 'Stock',
  etf: 'ETF',
  gold: 'Gold',
  fixed_deposit: 'Fixed deposit',
  bond: 'Bond',
  ppf: 'PPF',
  epf: 'EPF',
  nps: 'NPS',
  other: 'Other',
};

export const ASSET_CLASSES = ['equity', 'debt', 'gold', 'other'] as const;

export const ASSET_CLASS_LABELS: Record<Asset['assetClass'], string> = {
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
  other: 'Other',
};

export const COMPOUNDING = ['quarterly', 'monthly', 'half_yearly', 'yearly', 'simple'] as const;

export const COMPOUNDING_LABELS: Record<(typeof COMPOUNDING)[number], string> = {
  quarterly: 'Quarterly',
  monthly: 'Monthly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  simple: 'Simple interest',
};

export const ACTION_LABELS: Record<InvestmentAction, string> = {
  buy: 'Buy',
  sell: 'Sell',
  split: 'Split',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
};

export type GroupKey = 'mf' | 'stock' | 'gold' | 'fixed' | 'nps' | 'other';

/** Display groups in order. `nameSub` and `unitWord` label the holdings table. */
export const GROUPS: {
  key: GroupKey;
  title: string;
  types: AssetType[];
  nameSub: string;
  unitWord: string;
}[] = [
  {
    key: 'mf',
    title: 'Mutual funds',
    types: ['mutual_fund'],
    nameSub: 'Folio no.',
    unitWord: 'units',
  },
  {
    key: 'stock',
    title: 'Stocks & ETFs',
    types: ['stock', 'etf'],
    nameSub: 'Demat account',
    unitWord: 'shares',
  },
  { key: 'gold', title: 'Gold', types: ['gold'], nameSub: 'Held in', unitWord: 'units' },
  {
    key: 'fixed',
    title: 'Fixed income',
    types: ['fixed_deposit', 'bond', 'ppf', 'epf'],
    nameSub: 'Details',
    unitWord: 'units',
  },
  { key: 'nps', title: 'NPS', types: ['nps'], nameSub: 'Account', unitWord: 'units' },
  { key: 'other', title: 'Other', types: ['other'], nameSub: 'Details', unitWord: 'units' },
];

export function groupOf(type: AssetType): GroupKey {
  return GROUPS.find((g) => g.types.includes(type))?.key ?? 'other';
}

export function defaultValuation(type: AssetType): Asset['valuation'] {
  if (['mutual_fund', 'stock', 'etf', 'gold'].includes(type)) return 'units';
  return type === 'fixed_deposit' ? 'fd' : 'manual';
}

export function defaultAssetClass(type: AssetType): Asset['assetClass'] {
  if (['mutual_fund', 'stock', 'etf'].includes(type)) return 'equity';
  if (type === 'gold') return 'gold';
  return type === 'other' ? 'other' : 'debt';
}

/** The actions an asset can record, in the drawer's order. */
export function actionsFor(valuation: Asset['valuation']): InvestmentAction[] {
  return valuation === 'units'
    ? ['buy', 'sell', 'dividend', 'split', 'fee']
    : ['deposit', 'withdrawal', 'interest', 'fee'];
}

/** 'Folio 12347731' → 'Folio ••7731'. Only runs of 5+ characters that contain a digit are masked. */
export function maskRef(ref: string | null): string {
  return (ref ?? '').replace(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}\b/g, (m) => `••${m.slice(-4)}`);
}
