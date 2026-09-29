import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { currentMonth, monthLabel } from '@/lib/domain/dates';

export default function DashboardPage() {
  return (
    <>
      <PageHead title={monthLabel(currentMonth())} />
      <Placeholder title="Dashboard">
        Net worth, the month&rsquo;s income and spending, budgets and the investment summary will
        appear here in phase 5.
      </Placeholder>
    </>
  );
}
