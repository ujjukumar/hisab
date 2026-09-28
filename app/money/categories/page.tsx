import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { MONEY_TABS } from '@/app/nav';

export default function CategoriesPage() {
  return (
    <>
      <PageHead title="Categories" tabs={<Tabs tabs={MONEY_TABS} label="Money sections" />} />
      <Placeholder title="Categories">
        Renaming, recolouring, hiding and merging categories arrives in phase 2.
      </Placeholder>
    </>
  );
}
