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
import { feedAssets } from '@/lib/domain/priceFeeds';
import { benchmarkList } from '@/lib/queries/benchmarks';
import { portfolio, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth, priceStatus, priceUpdate } from '@/lib/queries/settings';

export default async function InvestmentTabsLayout({ children }: { children: ReactNode }) {
  const date = today();
  const rows = portfolio(date);
  const t = totals(rows, date);
  // Without an ISIN (or a benchmark) nothing can be fetched, so say how to fix that instead.
  const priced =
    feedAssets(rows.filter((r) => !r.sold).map((r) => r.asset)).length > 0 ||
    benchmarkList().length > 0;
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
          priced ? (
            <>
              {last ? priceStatus(last) : 'Prices not updated automatically yet.'}{' '}
              <UpdatePricesButton link />
            </>
          ) : rows.length > 0 ? (
            'Add an ISIN under Symbol or code to fetch prices automatically.'
          ) : undefined
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
