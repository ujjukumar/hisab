import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { INVESTMENT_TABS } from '@/app/nav';

export default function PerformancePage() {
  return (
    <>
      <PageHead
        title="Performance"
        tabs={<Tabs tabs={INVESTMENT_TABS} label="Investment sections" />}
      />
      <Placeholder title="Performance">
        Invested against worth over time, XIRR per holding, and the best and worst performers arrive
        in phase 3.
      </Placeholder>
    </>
  );
}
