import type { Tab } from '@/components/Tabs/Tabs';

/** The tab rows under the Money and Investments page heads. */

export const MONEY_TABS: Tab[] = [
  { href: '/money', label: 'Transactions' },
  { href: '/money/budgets', label: 'Budgets' },
  { href: '/money/accounts', label: 'Accounts' },
  { href: '/money/categories', label: 'Categories' },
];

export const INVESTMENT_TABS: Tab[] = [
  { href: '/investments', label: 'Holdings' },
  { href: '/investments/performance', label: 'Performance' },
  { href: '/investments/transactions', label: 'Transactions' },
];
