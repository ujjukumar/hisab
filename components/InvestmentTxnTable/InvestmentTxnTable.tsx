import type { ReactNode } from 'react';
import {
  Amount,
  DataTable,
  DateCell,
  NameCell,
  tableStyles,
  type TableSort,
  type Column,
} from '@/components/DataTable/DataTable';
import { InvestmentTxnMenu } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { ACTION_LABELS } from '@/lib/domain/assets';
import { formatAmount, formatDate, formatUnits, MINUS } from '@/lib/domain/format';
import { unitsAmount } from '@/lib/domain/holdings';
import type { InvTxnRow } from '@/lib/queries/investments';

const PAID = new Set(['buy', 'deposit', 'fee']);

/** Money out of the owner's pocket; an intraday trade only when it lost money. */
const paid = (t: InvTxnRow) =>
  t.action === 'intraday' ? (t.total ?? 0) < 0 : PAID.has(t.action);

const price = (p: string) => formatAmount(unitsAmount('1', p), 2);

/** Whole numbers without decimals, everything else to three places. */
const units = (u: string) => formatUnits(u, Number.isInteger(Number(u)) ? 0 : 3);

const columns = (showAsset: boolean): Column<InvTxnRow>[] => [
  {
    key: 'date',
    header: 'Date',
    align: 'l',
    sortable: true,
    sortValue: (t) => t.date,
    cell: (t) => <DateCell>{formatDate(t.date)}</DateCell>,
  },
  ...(showAsset
    ? [
        {
          key: 'asset',
          header: 'Investment',
          sub: 'Account ref',
          align: 'l',
          sortable: true,
          sortValue: (t: InvTxnRow) => t.assetName,
          cell: (t) => (
            <NameCell href={`/investments/${t.assetId}`} name={t.assetName} sub={t.ref || t.note} />
          ),
        } satisfies Column<InvTxnRow>,
      ]
    : []),
  {
    key: 'action',
    header: 'Action',
    align: 'l',
    sortable: true,
    sortValue: (t) => t.action,
    cell: (t) => (
      <>
        <span className={tableStyles.catChip}>{ACTION_LABELS[t.action]}</span>
        {!showAsset && t.note && <span className={tableStyles.nameSub}>{t.note}</span>}
      </>
    ),
  },
  {
    key: 'price',
    header: 'Price',
    sortable: true,
    sortValue: (t) => t.price ? Number(t.price) : null,
    cell: (t) =>
      t.price ? (
        <Amount sub={t.sellPrice ? `Sold ${price(t.sellPrice)}` : undefined}>{price(t.price)}</Amount>
      ) : (
        null
      ),
  },
  {
    key: 'units',
    header: 'Units',
    sub: '+/−',
    sortable: true,
    sortValue: (t) => t.units ? Number(t.units) * (t.action === 'sell' ? -1 : 1) : null,
    cell: (t) =>
      t.action === 'split' ? (
        <Amount sub="Split">
          {t.splitFrom}:{t.splitTo}
        </Amount>
      ) : t.units ? (
        <Amount sub={t.action === 'intraday' ? 'Same day' : undefined}>
          {t.action === 'sell' ? MINUS : t.action === 'intraday' ? '' : '+'}
          {units(t.units)}
        </Amount>
      ) : (
        null
      ),
  },
  {
    key: 'balance',
    header: 'Balance units',
    sortable: true,
    sortValue: (t) => t.balanceUnits ? Number(t.balanceUnits) : null,
    cell: (t) => (t.balanceUnits === null ? null : <Amount>{units(t.balanceUnits)}</Amount>),
  },
  {
    key: 'amount',
    header: 'Amount',
    sortOptions: [
      {
        key: 'amount',
        header: 'Amount',
        sortValue: (t) => t.total === null ? null : t.total * (PAID.has(t.action) ? -1 : 1),
      },
      {
        key: 'fees',
        header: 'Fees',
        sortValue: (t) => t.fees,
      },
    ],
    cell: (t) =>
      t.total === null ? (
        null
      ) : (
        <Amount
          sub={t.fees ? formatAmount(t.fees, 2) : undefined}
          tone={t.action === 'intraday' && t.total ? (t.total < 0 ? 'neg' : 'pos') : undefined}
        >
          {paid(t) ? MINUS : '+'}
          {formatAmount(Math.abs(t.total), 2)}
        </Amount>
      ),
  },
  {
    key: 'account',
    header: 'Linked account',
    align: 'l',
    sortable: true,
    sortValue: (t) => t.accountName,
    cell: (t) =>
      t.accountName ? <span className={tableStyles.catChip}>{t.accountName}</span> : null,
  },
];

/** Investment transactions, newest first. The Investment column is left out on a holding's own page. */
export function InvestmentTxnTable({
  title,
  actions,
  rows,
  empty,
  showAsset = true,
  sort,
  sortHref,
}: {
  title: ReactNode;
  actions?: ReactNode;
  rows: InvTxnRow[];
  empty: ReactNode;
  showAsset?: boolean;
  sort: TableSort;
  sortHref: (key: string, dir: 'asc' | 'desc') => string;
}) {
  return (
    <DataTable
      title={title}
      actions={actions}
      columns={columns(showAsset)}
      rows={rows}
      rowKey={(t) => t.id}
      sort={sort}
      sortHref={sortHref}
      menu={(t) => <InvestmentTxnMenu row={t} />}
      empty={empty}
    />
  );
}
