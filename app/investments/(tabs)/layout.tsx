import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/Button/Button';
import { AddInvestmentButton } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { PageHead } from '@/components/PageHead/PageHead';
import { InvestmentChange } from '@/components/StatStrip/InvestmentChange';
import { UpdatePricesButton } from '@/components/Prices/Prices';
import { Tabs } from '@/components/Tabs/Tabs';
import { INVESTMENT_TABS } from '@/app/nav';
import { today } from '@/lib/domain/dates';
import { formatReturn, formatShortINR, formatShortINRSigned, gainClass } from '@/lib/domain/format';
import { PERIODS, investmentPeriodRows, periodTotals } from '@/lib/domain/performance';
import { totals } from '@/lib/domain/portfolio';
import { portfolio, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth, priceStatus, priceUpdate } from '@/lib/queries/settings';

export default async function InvestmentTabsLayout({ children }: { children: ReactNode }) {
  const date = today();
  const t = totals(portfolio(date), date);
  const last = await priceUpdate();
  const yearStart = await financialYearStartMonth();
  const data = portfolioData();
  const changes = PERIODS.map((period) => {
    const result = periodTotals(investmentPeriodRows(data, period, date, yearStart), date);
    return { period, gain: result.gain, absolute: result.absolute };
  });

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
          { label: 'Change in period', value: <InvestmentChange changes={changes} /> },
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
