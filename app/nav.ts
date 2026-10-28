import type { Tab } from '@/components/Tabs/Tabs';

/** The tab rows under the Money and Investments page heads. */

export const MONEY_TABS: Tab[] = [
  { href: '/money', label: 'Transactions' },
  { href: '/money/sms', label: 'SMS', match: 'prefix', countLabel: 'waiting for review' },
  { href: '/money/budgets', label: 'Budgets' },
  { href: '/money/accounts', label: 'Accounts' },
  { href: '/money/categories', label: 'Categories' },
];

/** The view row inside Money -> SMS. */
export const SMS_TABS: Tab[] = [
  { href: '/money/sms', label: 'Review', countLabel: 'waiting for review' },
  { href: '/money/sms/history', label: 'History' },
  { href: '/money/sms/rules', label: 'Rules' },
  { href: '/money/sms/devices', label: 'Devices', countLabel: 'waiting to connect' },
];

export const INVESTMENT_TABS: Tab[] = [
  { href: '/investments', label: 'Overview' },
  { href: '/investments/performance', label: 'Performance' },
  { href: '/investments/transactions', label: 'Transactions' },
];

export const TAX_TABS: Tab[] = [
  { href: '/tax', label: 'Estimate' },
  { href: '/tax/gains', label: 'Capital gains' },
];
