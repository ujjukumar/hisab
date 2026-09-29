/** Categories created on first run and after `npm run reset`. Colours are token names c1…c8. */
export const DEFAULT_CATEGORIES: { name: string; kind: 'income' | 'expense'; color: string }[] = [
  { name: 'Housing', kind: 'expense', color: 'c1' },
  { name: 'Groceries', kind: 'expense', color: 'c2' },
  { name: 'Dining', kind: 'expense', color: 'c3' },
  { name: 'Transport', kind: 'expense', color: 'c4' },
  { name: 'Shopping', kind: 'expense', color: 'c5' },
  { name: 'Utilities', kind: 'expense', color: 'c6' },
  { name: 'Health', kind: 'expense', color: 'c7' },
  { name: 'Entertainment', kind: 'expense', color: 'c8' },
  { name: 'Education', kind: 'expense', color: 'c1' },
  { name: 'Travel', kind: 'expense', color: 'c2' },
  { name: 'Insurance', kind: 'expense', color: 'c3' },
  { name: 'Personal care', kind: 'expense', color: 'c4' },
  { name: 'Gifts', kind: 'expense', color: 'c5' },
  { name: 'Other', kind: 'expense', color: 'c6' },
  { name: 'Salary', kind: 'income', color: 'c1' },
  { name: 'Freelance', kind: 'income', color: 'c2' },
  { name: 'Dividends', kind: 'income', color: 'c5' },
  { name: 'Interest', kind: 'income', color: 'c6' },
  { name: 'Refunds', kind: 'income', color: 'c3' },
  { name: 'Other income', kind: 'income', color: 'c8' },
];

export const DEFAULT_SETTINGS: { key: string; value: string }[] = [
  { key: 'financial_year_start_month', value: '4' },
  { key: 'default_fd_compounding', value: '"quarterly"' },
  { key: 'sample_data', value: 'false' },
];

/** Overview sub-tabs and table order. Only groups with holdings are shown. */
export const DISPLAY_GROUPS = [
  { key: 'mutual_funds', title: 'Mutual funds', types: ['mutual_fund'] },
  { key: 'stocks_etfs', title: 'Stocks & ETFs', types: ['stock', 'etf'] },
  { key: 'gold', title: 'Gold', types: ['gold'] },
  { key: 'fixed_income', title: 'Fixed income', types: ['fixed_deposit', 'bond', 'ppf', 'epf'] },
  { key: 'nps', title: 'NPS', types: ['nps'] },
  { key: 'other', title: 'Other', types: ['other'] },
] as const;

export type DisplayGroupKey = (typeof DISPLAY_GROUPS)[number]['key'];
