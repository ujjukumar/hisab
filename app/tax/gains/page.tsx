import { ButtonLink } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  DateCell,
  NameCell,
  tableSortFromParams,
  tableSortHref,
  type Column,
} from '@/components/DataTable/DataTable';
import { Tag } from '@/components/Tag/Tag';
import { GAIN_KIND_LABELS } from '@/lib/domain/capitalGains';
import { formatAmount, formatDate, formatUnits, gainClass } from '@/lib/domain/format';
import { taxReport, type GainRow } from '@/lib/queries/tax';
import { TaxHead, YearFilter } from '../TaxHead';

const columns: Column<GainRow>[] = [
  {
    key: 'name',
    header: 'Investment',
    align: 'l',
    sortable: true,
    sortValue: (g) => g.assetName,
    cell: (g) => <NameCell name={g.assetName} href={`/investments/${g.assetId}`} />,
  },
  {
    key: 'bought',
    header: 'Bought',
    align: 'l',
    sortable: true,
    sortValue: (g) => g.bought,
    cell: (g) => <DateCell>{formatDate(g.bought)}</DateCell>,
  },
  {
    key: 'sold',
    header: 'Sold',
    align: 'l',
    sortable: true,
    sortValue: (g) => g.sold,
    cell: (g) => <DateCell>{formatDate(g.sold)}</DateCell>,
  },
  {
    key: 'units',
    header: 'Units',
    sortable: true,
    sortValue: (g) => g.units.toNumber(),
    cell: (g) => (
      <Amount>{formatUnits(g.units.toNumber(), g.units.isInteger() ? 0 : 3)}</Amount>
    ),
  },
  {
    key: 'cost',
    header: 'Cost',
    sortable: true,
    sortValue: (g) => g.cost,
    cell: (g) => <Amount>{formatAmount(g.cost)}</Amount>,
  },
  {
    key: 'proceeds',
    header: 'Sale value',
    sub: 'after charges',
    sortable: true,
    sortValue: (g) => g.proceeds,
    cell: (g) => <Amount>{formatAmount(g.proceeds)}</Amount>,
  },
  {
    key: 'gain',
    header: 'Gain',
    sortable: true,
    sortValue: (g) => g.gain,
    cell: (g) => <Amount tone={gainClass(g.gain)}>{formatAmount(g.gain)}</Amount>,
  },
  {
    key: 'treatment',
    header: 'Taxed as',
    align: 'l',
    sortable: true,
    sortValue: (g) => GAIN_KIND_LABELS[g.kind],
    cell: (g) =>
      g.kind === 'indexation' || g.kind === 'grandfathered' ? (
        <Tag>{GAIN_KIND_LABELS[g.kind]}</Tag>
      ) : (
        <>
          {GAIN_KIND_LABELS[g.kind]}
          {g.rate !== null && `, ${g.rate}%`}
        </>
      ),
  },
];

export default async function TaxGainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const r = taxReport(params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') search.set(key, value);
  }
  const sort = tableSortFromParams(
    search,
    columns.map((c) => c.key),
  );
  const total = (pick: (g: GainRow) => number) => r.gains.reduce((s, g) => s + pick(g), 0);
  const gain = total((g) => g.gain);

  return (
    <>
      <TaxHead report={r} />
      <div className="wrap page-body">
        <YearFilter report={r} path="/tax/gains" />
        <DataTable
          title={`Sales in ${r.label}`}
          columns={columns}
          rows={r.gains}
          rowKey={(g) => g.key}
          sort={sort}
          sortHref={(key, dir) => tableSortHref('/tax/gains', search.toString(), key, dir)}
          empty={
            <>
              <p>{`No sales in ${r.label}. Record a sale in Investments and its gain shows here.`}</p>
              <ButtonLink variant="secondary" href="/investments/transactions">
                Go to investment transactions
              </ButtonLink>
            </>
          }
          footer={
            <tr>
              <td className="l" colSpan={4}>
                Total
              </td>
              <td className="r">
                <Amount>{formatAmount(total((g) => g.cost))}</Amount>
              </td>
              <td className="r">
                <Amount>{formatAmount(total((g) => g.proceeds))}</Amount>
              </td>
              <td className="r">
                <Amount tone={gainClass(gain)}>{formatAmount(gain)}</Amount>
              </td>
              <td />
            </tr>
          }
        />
        <p className="footnote">
          All amounts in ₹. Each sale is matched to the oldest units first, so costs here can
          differ from the average cost in Investments. A sale that took units from more than one
          purchase shows once for each. Sales marked Left out aren&apos;t in the estimate.
        </p>
      </div>
    </>
  );
}
