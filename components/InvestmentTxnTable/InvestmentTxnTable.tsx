import type { ReactNode } from 'react';
import {
  Amount,
  DataTable,
  DateCell,
  NameCell,
  tableStyles,
  type Column,
} from '@/components/DataTable/DataTable';
import { InvestmentTxnMenu } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { ACTION_LABELS } from '@/lib/domain/assets';
import { formatAmount, formatDate, formatUnits, MINUS } from '@/lib/domain/format';
import { unitsAmount } from '@/lib/domain/holdings';
import type { InvTxnRow } from '@/lib/queries/investments';

const MUTED = <Amount tone="muted">—</Amount>;
const PAID = new Set(['buy', 'deposit', 'fee']);

/** Whole numbers without decimals, everything else to three places. */
const units = (u: string) => formatUnits(u, Number.isInteger(Number(u)) ? 0 : 3);

const columns = (showAsset: boolean): Column<InvTxnRow>[] => [
  {
    key: 'date',
    header: 'Date',
    align: 'l',
    cell: (t) => <DateCell>{formatDate(t.date)}</DateCell>,
  },
  ...(showAsset
    ? [
        {
          key: 'asset',
          header: 'Investment',
          sub: 'Account ref',
          align: 'l',
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
    cell: (t) => (t.price ? <Amount>{formatAmount(unitsAmount('1', t.price), 2)}</Amount> : MUTED),
  },
  {
    key: 'units',
    header: 'Units',
    sub: '+/−',
    cell: (t) =>
      t.action === 'split' ? (
        <Amount sub="Split">
          {t.splitFrom}:{t.splitTo}
        </Amount>
      ) : t.units ? (
        <Amount>
          {t.action === 'sell' ? MINUS : '+'}
          {units(t.units)}
        </Amount>
      ) : (
        MUTED
      ),
  },
  {
    key: 'balance',
    header: 'Balance units',
    cell: (t) => (t.balanceUnits === null ? MUTED : <Amount>{units(t.balanceUnits)}</Amount>),
  },
  {
    key: 'amount',
    header: 'Amount',
    sub: 'Fees',
    cell: (t) =>
      t.total === null ? (
        MUTED
      ) : (
        <Amount sub={t.fees ? formatAmount(t.fees, 2) : undefined}>
          {PAID.has(t.action) ? MINUS : '+'}
          {formatAmount(t.total, 2)}
        </Amount>
      ),
  },
  {
    key: 'account',
    header: 'Linked account',
    align: 'l',
    cell: (t) =>
      t.accountName ? <span className={tableStyles.catChip}>{t.accountName}</span> : MUTED,
  },
];

/** Investment transactions, newest first. The Investment column is left out on a holding's own page. */
export function InvestmentTxnTable({
  title,
  actions,
  rows,
  empty,
  showAsset = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  rows: InvTxnRow[];
  empty: ReactNode;
  showAsset?: boolean;
}) {
  return (
    <DataTable
      title={title}
      actions={actions}
      columns={columns(showAsset)}
      rows={rows}
      rowKey={(t) => t.id}
      menu={(t) => <InvestmentTxnMenu row={t} />}
      empty={empty}
    />
  );
}
