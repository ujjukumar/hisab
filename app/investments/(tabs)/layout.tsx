import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/Button/Button';
import { AddInvestmentButton } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { PageHead } from '@/components/PageHead/PageHead';
import { UpdatePricesButton } from '@/components/Prices/Prices';
import { Tabs } from '@/components/Tabs/Tabs';
import { INVESTMENT_TABS } from '@/app/nav';
import { today } from '@/lib/domain/dates';
import {
  formatDay,
  formatINRSigned,
  formatPercent,
  formatReturn,
  formatShortINR,
  formatShortINRSigned,
  gainClass,
} from '@/lib/domain/format';
import { totals } from '@/lib/domain/portfolio';
import { portfolio } from '@/lib/queries/investments';
import { priceStatus, priceUpdate } from '@/lib/queries/settings';

export default async function InvestmentTabsLayout({ children }: { children: ReactNode }) {
  const t = totals(portfolio(), today());
  const last = await priceUpdate();

  return (
    <>
      <PageHead
        title="Investments"
        sub={
          <>
            {last ? priceStatus(last) : 'Prices not updated automatically yet.'}{' '}
            <UpdatePricesButton link />
          </>
        }
        actions={
          <>
            <ButtonLink variant="secondary" href="/investments/import">
              Import
            </ButtonLink>
            <AddInvestmentButton />
          </>
        }
        statsVariant="three"
        stats={[
          {
            label: 'Current value',
            value: formatShortINR(t.value),
            aside: `${formatShortINR(t.invested)} invested`,
          },
          t.change
            ? {
                label: `Change since ${formatDay(t.change.since)}`,
                value: formatINRSigned(t.change.amount),
                aside: formatPercent(t.change.percent),
                tone: gainClass(t.change.amount),
                asideTone: gainClass(t.change.amount),
              }
            : { label: 'Change since last update', value: '—', aside: 'Needs two prices' },
          {
            label: 'All-time returns',
            value: formatShortINRSigned(t.allTime),
            aside: formatReturn(t.ret),
            tone: gainClass(t.allTime),
            asideTone: gainClass((t.ret?.rate ?? 0) * 100),
          },
        ]}
        tabs={<Tabs tabs={INVESTMENT_TABS} label="Investment sections" />}
      />
      {children}
    </>
  );
}
