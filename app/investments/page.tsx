import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { INVESTMENT_TABS } from '@/app/nav';

export default function InvestmentsPage() {
  return (
    <>
      <PageHead
        title="Investments"
        tabs={<Tabs tabs={INVESTMENT_TABS} label="Investment sections" />}
      />
      <Placeholder title="Holdings">
        Holdings grouped by kind, with units, cost, worth and gain, arrive in phase 3.
      </Placeholder>
    </>
  );
}
