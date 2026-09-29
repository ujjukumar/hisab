import Link from 'next/link';
import { ButtonLink } from '@/components/Button/Button';
import {
  Amount,
  CategoryChip,
  DataTable,
  DateCell,
  DescCell,
  tableStyles,
  type Column,
} from '@/components/DataTable/DataTable';
import { TransactionFilters } from '@/components/TransactionFilters/TransactionFilters';
import {
  AddTransactionButton,
  TransactionRowMenu,
} from '@/components/TransactionDrawer/TransactionDrawer';
import { currentMonth, endOfMonth, monthLabel, startOfMonth } from '@/lib/domain/dates';
import { formatAmount, formatDate, MINUS } from '@/lib/domain/format';
import {
  listAccounts,
  listCategories,
  listTransactions,
  PAGE_SIZE,
  parseTxnFilters,
  txnFilterParams,
  wholeMonth,
  type TxnFilters,
  type TxnRow,
} from '@/lib/queries/money';

const INVESTMENTS = 'Investments';

const columns: Column<TxnRow>[] = [
  {
    key: 'date',
    header: 'Date',
    align: 'l',
    sortable: true,
    cell: (t) => <DateCell>{formatDate(t.date)}</DateCell>,
  },
  {
    key: 'desc',
    header: 'Description',
    sub: 'Note',
    align: 'l',
    cell: (t) => (
      <DescCell
        desc={
          <>
            {t.description}
            {t.assetId && <span className={tableStyles.tag}>Linked</span>}
          </>
        }
        note={t.note}
      />
    ),
  },
  {
    key: 'category',
    header: 'Category',
    align: 'l',
    cell: (t) =>
      t.type === 'transfer' ? (
        <CategoryChip name="Transfer" color="var(--c-muted)" />
      ) : (
        <CategoryChip name={t.categoryName} color={`var(--${t.categoryColor})`} />
      ),
  },
  {
    key: 'account',
    header: 'Account',
    align: 'l',
    cell: (t) => <span className={tableStyles.catChip}>{t.accountName ?? INVESTMENTS}</span>,
  },
  {
    key: 'amount',
    header: 'Amount',
    sortable: true,
    cell: (t) =>
      t.type === 'income' ? (
        <Amount tone="pos">+{formatAmount(t.amount)}</Amount>
      ) : t.type === 'expense' ? (
        <Amount>
          {MINUS}
          {formatAmount(t.amount)}
        </Amount>
      ) : (
        <Amount tone="muted" sub={`to ${t.toAccountName ?? INVESTMENTS}`}>
          {formatAmount(t.amount)}
        </Amount>
      ),
  },
];

const href = (f: TxnFilters) => {
  const query = txnFilterParams(f).toString();
  return query ? `/money?${query}` : '/money';
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = parseTxnFilters(await searchParams);
  const { rows, count, income, spending } = listTransactions(f);
  const month = wholeMonth(f.from, f.to);
  const title = month ? monthLabel(month) : `${formatDate(f.from)} to ${formatDate(f.to)}`;
  const defaults = { from: startOfMonth(currentMonth()), to: endOfMonth(currentMonth()) };
  const filtered =
    Boolean(f.type || f.categoryId || f.accountId || f.q) ||
    f.from !== defaults.from ||
    f.to !== defaults.to;
  const exportQuery = txnFilterParams({ ...f, limit: PAGE_SIZE }).toString();

  return (
    <div className="wrap page-body">
      <TransactionFilters
        values={{
          from: f.from,
          to: f.to,
          type: f.type ?? '',
          cat: f.categoryId ? String(f.categoryId) : '',
          acct: f.accountId ? String(f.accountId) : '',
          q: f.q,
        }}
        defaults={defaults}
        accounts={listAccounts().map(({ id, name, archived }) => ({ id, name, archived }))}
        categories={listCategories()}
      />

      <DataTable
        title={`${title} (${count})`}
        actions={
          count > 0 && (
            <ButtonLink
              variant="secondary"
              icon="download"
              download
              href={`/api/export/transactions${exportQuery ? `?${exportQuery}` : ''}`}
            >
              Export CSV
            </ButtonLink>
          )
        }
        narrow
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        sort={{ key: f.sort, dir: f.dir }}
        sortHref={(key, dir) =>
          href({ ...f, sort: key === 'amount' ? 'amount' : 'date', dir, limit: PAGE_SIZE })
        }
        menu={(t) => <TransactionRowMenu row={t} />}
        empty={
          filtered ? (
            <>
              <p>No transactions match these filters.</p>
              <ButtonLink variant="secondary" href="/money">
                Clear filters
              </ButtonLink>
            </>
          ) : (
            <>
              <p>
                No transactions in {title} yet. Add one to start tracking where your money goes.
              </p>
              <AddTransactionButton />
            </>
          )
        }
        footer={
          <tr>
            <td className="l" colSpan={4}>
              Total
            </td>
            <td className="r">
              <Amount tone="pos" sub={`${MINUS}${formatAmount(spending)} spent`}>
                +{formatAmount(income)}
              </Amount>
            </td>
            <td />
          </tr>
        }
      />

      {rows.length < count && (
        <p className="footnote">
          Showing {rows.length} of {count}.{' '}
          <Link href={href({ ...f, limit: f.limit + PAGE_SIZE })} scroll={false}>
            Show more
          </Link>
        </p>
      )}
      <p className="footnote">
        All amounts in ₹. Transfers move money between your own accounts, so they don&apos;t count
        as income or spending.
      </p>
    </div>
  );
}
