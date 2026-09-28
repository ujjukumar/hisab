import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { MONEY_TABS } from '@/app/nav';

export default function BudgetsPage() {
  return (
    <>
      <PageHead title="Budgets" tabs={<Tabs tabs={MONEY_TABS} label="Money sections" />} />
      <Placeholder title="Budgets">
        Monthly budgets per category, with bars that turn red when a budget is passed, arrive in
        phase 2.
      </Placeholder>
    </>
  );
}
