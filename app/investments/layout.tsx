import type { ReactNode } from 'react';
import { InvestmentDrawerProvider } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { assetOptions } from '@/lib/queries/investments';
import { listAccounts } from '@/lib/queries/money';

/** Every investments page shares one drawer, so row menus and head buttons can open it. */
export default function InvestmentsLayout({ children }: { children: ReactNode }) {
  const accounts = listAccounts().map(({ id, name, archived }) => ({ id, name, archived }));
  return (
    <InvestmentDrawerProvider options={assetOptions()} accounts={accounts}>
      {children}
    </InvestmentDrawerProvider>
  );
}
