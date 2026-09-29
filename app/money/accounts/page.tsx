import Link from 'next/link';
import { AccountsTable } from '@/components/AccountsTable/AccountsTable';
import { listAccounts } from '@/lib/queries/money';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const showArchived = (await searchParams).archived === '1';
  const all = listAccounts();
  const archived = all.filter((a) => a.archived).length;

  return (
    <div className="wrap page-body">
      {archived > 0 && (
        <p className="tbl-note">
          {showArchived ? (
            <Link className="linkish" href="/money/accounts">
              Hide archived accounts
            </Link>
          ) : (
            <>
              {archived === 1
                ? '1 archived account is hidden.'
                : `${archived} archived accounts are hidden.`}{' '}
              <Link className="linkish" href="/money/accounts?archived=1">
                Show archived accounts
              </Link>
            </>
          )}
        </p>
      )}
      <AccountsTable rows={showArchived ? all : all.filter((a) => !a.archived)} />
      <p className="footnote">
        All amounts in ₹. Current balance is the opening balance plus every transaction since that
        date.
      </p>
    </div>
  );
}
