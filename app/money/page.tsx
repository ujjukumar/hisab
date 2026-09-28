import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { MONEY_TABS } from '@/app/nav';

export default function MoneyPage() {
  return (
    <>
      <PageHead title="Money" tabs={<Tabs tabs={MONEY_TABS} label="Money sections" />} />
      <Placeholder title="Transactions">
        The filterable transaction table, with sorting and the add and edit drawers, arrives in
        phase 2.
      </Placeholder>
    </>
  );
}
