import type { ReactNode } from 'react';
import { PageHead } from '@/components/PageHead/PageHead';
import { Tabs } from '@/components/Tabs/Tabs';
import {
  AddTransactionButton,
  TransactionDrawerProvider,
} from '@/components/TransactionDrawer/TransactionDrawer';
import { MONEY_TABS } from '@/app/nav';
import { monthLabel } from '@/lib/domain/dates';
import { formatINR } from '@/lib/domain/format';
import { listAccounts, listCategories, moneyStrip } from '@/lib/queries/money';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function MoneyLayout({ children }: { children: ReactNode }) {
  const s = moneyStrip();
  const month = monthLabel(s.month).split(' ')[0];
  const accounts = listAccounts().map(({ id, name, archived }) => ({ id, name, archived }));

  return (
    <TransactionDrawerProvider accounts={accounts} categories={listCategories()}>
      <PageHead
        title="Money"
        actions={<AddTransactionButton />}
        stats={[
          {
            label: `Income in ${month}`,
            value: formatINR(s.income),
            aside: plural(s.incomeCount, 'payment received', 'payments received'),
          },
          {
            label: `Spent in ${month}`,
            value: formatINR(s.spending),
            aside: !s.budget
              ? 'No budget set'
              : s.spending > s.budget
                ? `over the ${formatINR(s.budget)} budget`
                : `of ${formatINR(s.budget)} budget`,
            asideTone: s.budget && s.spending > s.budget ? 'neg' : '',
          },
          {
            label: `Saved in ${month}`,
            value: formatINR(s.saved),
            aside:
              s.savingsRate === null ? 'No income yet' : `${Math.round(s.savingsRate)}% of income`,
            asideTone: s.saved > 0 ? 'pos' : s.saved < 0 ? 'neg' : '',
          },
          {
            label: 'In bank and cash',
            value: formatINR(s.bankAndCash),
            aside: plural(s.accountCount, 'account', 'accounts'),
          },
        ]}
        tabs={<Tabs tabs={MONEY_TABS} label="Money sections" />}
      />
      {children}
    </TransactionDrawerProvider>
  );
}
