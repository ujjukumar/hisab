import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { INVESTMENT_TABS } from '@/app/nav';

export default function InvestmentTransactionsPage() {
  return (
    <>
      <PageHead
        title="Investment transactions"
        tabs={<Tabs tabs={INVESTMENT_TABS} label="Investment sections" />}
      />
      <Placeholder title="Investment transactions">
        Buys, sells, deposits, dividends and interest across every holding arrive in phase 4.
      </Placeholder>
    </>
  );
}
