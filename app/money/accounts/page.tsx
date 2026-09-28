import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';
import { Tabs } from '@/components/Tabs/Tabs';
import { MONEY_TABS } from '@/app/nav';

export default function AccountsPage() {
  return (
    <>
      <PageHead title="Accounts" tabs={<Tabs tabs={MONEY_TABS} label="Money sections" />} />
      <Placeholder title="Accounts">
        Bank, card, cash and wallet accounts with their running balances arrive in phase 2.
      </Placeholder>
    </>
  );
}
