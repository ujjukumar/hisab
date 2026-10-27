import { ButtonLink } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import {
  Amount,
  DataTable,
  NameCell,
  tableSortFromParams,
  type Column,
} from '@/components/DataTable/DataTable';
import { SelectField, TextField } from '@/components/Field/Field';
import { AddInvestmentButton } from '@/components/InvestmentDrawer/InvestmentDrawer';
import { StatStrip } from '@/components/StatStrip/StatStrip';
import { FilterForm } from '@/components/TransactionFilters/TransactionFilters';
import { ASSET_TYPE_LABELS, GROUPS, maskRef } from '@/lib/domain/assets';
import { addDays, today } from '@/lib/domain/dates';
import {
  formatAmount,
  formatAmountSigned,
  formatDate,
  formatINRSigned,
  formatPercent,
  gainClass,
} from '@/lib/domain/format';
import {
  linePoints,
  PERIOD_LABELS,
  PERIODS,
  performanceSeries,
  periodTotals,
  seriesCadence,
  type PerformancePeriod,
  type PeriodResult,
  type PeriodRow,
} from '@/lib/domain/performance';
import { periodPerformance, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

const percent = (rate: number | null) => (rate === null ? '' : formatPercent(rate * 100, 1));
const SORT_KEYS = ['name', 'value', 'invested', 'gain', 'absolute', 'annual'] as const;

/** The three period figures, as table cells. */
function figures(r: PeriodResult) {
  return [
    <Amount key="gain" tone={gainClass(r.gain)}>
      {formatAmountSigned(r.gain)}
    </Amount>,
    <Amount key="abs" tone={r.absolute === null ? 'muted' : gainClass(r.absolute * 100)}>
      {percent(r.absolute)}
    </Amount>,
    <Amount key="pa" tone={r.annual === null ? 'muted' : gainClass(r.annual * 100)}>
      {percent(r.annual)}
    </Amount>,
  ];
}

const columns = (period: PerformancePeriod, annual: boolean): Column<PeriodRow>[] => [
  {
    key: 'name',
    header: 'Name',
    align: 'l',
    sortable: true,
    sortValue: ({ row }) => row.asset.name,
    cell: ({ row }) => (
      <NameCell
        href={`/investments/${row.asset.id}${period === '1d' || period === 'custom' ? '' : `?period=${period}`}`}
        name={row.asset.name}
        sub={maskRef(row.asset.accountRef) || ASSET_TYPE_LABELS[row.asset.type]}
      />
    ),
  },
  {
    key: 'value',
    header: 'Current value',
    sortable: true,
    sortValue: (r) => r.row.value,
    cell: ({ row }) => <Amount>{formatAmount(row.value)}</Amount>,
  },
  {
    key: 'invested',
    header: 'Invested',
    sortable: true,
    sortValue: (r) => r.row.sold ? 0 : r.row.holding.cost,
    cell: ({ row }) => <Amount>{formatAmount(row.sold ? 0 : row.holding.cost)}</Amount>,
  },
  ...([
    { key: 'gain', header: 'Gain in period', value: (r: PeriodRow) => r.gain },
    { key: 'absolute', header: '% absolute', value: (r: PeriodRow) => r.absolute },
    { key: 'annual', header: '% p.a.', value: (r: PeriodRow) => r.annual },
  ] as const).map(({ key, header, value }, i) => ({
    key,
    header,
    sortable: true,
    sortValue: value,
    cell: (r: PeriodRow) => figures(r)[i],
  })).filter((column) => annual || column.key !== 'annual'),
];

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const yearStart = await financialYearStartMonth();
  const { asOf, period, from, rows } = periodPerformance(params, yearStart);
  const total = periodTotals(rows, asOf);
  // % p.a. needs a year or more; hide the column when no holding has one.
  const annual = total.annual !== null || rows.some((r) => r.annual !== null);
  const sort = tableSortFromParams(
    new URLSearchParams({ sort: typeof params.sort === 'string' ? params.sort : '', dir: typeof params.dir === 'string' ? params.dir : '' }),
    SORT_KEYS,
  );
  const cadence = seriesCadence(from, asOf);
  const shown = linePoints(performanceSeries(portfolioData(), asOf, from), cadence);
  const kept = { asof: asOf, period, ...(period === 'custom' && from ? { from } : {}) };
  const query = new URLSearchParams(kept).toString();
  const sortHref = (key: string, dir: 'asc' | 'desc') => {
    const search = new URLSearchParams({ ...kept, sort: key, dir });
    return `/investments/performance?${search}`;
  };
  const periodLabel = period === 'custom' ? 'Custom' : PERIOD_LABELS[period];

  const span = period === '1d'
    ? `Latest daily prices per holding through ${formatDate(asOf)}`
    : from
      ? `${formatDate(addDays(from, 1))} to ${formatDate(asOf)}`
      : `All time to ${formatDate(asOf)}`;

  return (
    <div className="wrap page-body">
      <FilterForm
        path="/investments/performance"
        label="Choose the period"
        values={kept}
      >
        <SelectField label="Period" name="period" defaultValue={period}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
          <option value="custom">Custom</option>
        </SelectField>
        {period === 'custom' && from && (
          <TextField label="From" name="from" type="date" max={addDays(asOf, -1)} defaultValue={from} />
        )}
        <TextField label={period === 'custom' ? 'To' : 'As of'} name="asof" type="date" max={today()} defaultValue={asOf} />
      </FilterForm>

      <div className="stack">
        <Card
          title={period === 'custom' ? 'Returns' : `Returns, ${periodLabel.toLowerCase()}`}
          sub={span}
          action={
            rows.length > 0 && (
              <ButtonLink
                variant="secondary"
                icon="download"
                download
                href={`/api/export/performance?${query}`}
              >
                Export CSV
              </ButtonLink>
            )
          }
        >
          <StatStrip
            variant="three"
            stats={[
              {
                label: 'Gain in period',
                value: formatINRSigned(total.gain),
                tone: gainClass(total.gain),
              },
              {
                label: 'Total return',
                value: percent(total.absolute),
                aside: 'absolute',
                tone: total.absolute === null ? '' : gainClass(total.absolute * 100),
              },
              {
                label: 'XIRR',
                value: percent(total.annual),
                aside: total.annual === null ? 'Needs a year or more' : 'p.a.',
                tone: total.annual === null ? '' : gainClass(total.annual * 100),
              },
            ]}
          />
        </Card>

        <Card
          title="Invested vs worth"
          sub={from
            ? `${cadence === 'daily' ? 'Available daily prices and transactions' : cadence === 'weekly' ? 'Weekly' : 'Monthly'} from ${formatDate(from)}`
            : 'Monthly, all time'}
        >
          <LegendInline>
            <LegendKey color="var(--c1)">Amount invested</LegendKey>
            <LegendKey color="var(--c2)">Current worth</LegendKey>
          </LegendInline>
          <LineChart points={shown} />
        </Card>

        {rows.length === 0 ? (
          <DataTable
            title="Holdings"
            columns={columns(period, annual)}
            rows={[]}
            rowKey={(r) => r.row.asset.id}
            sort={sort}
            sortHref={sortHref}
            empty={
              <>
                <p>No investments in this period. Add one to start tracking its returns.</p>
                <AddInvestmentButton />
              </>
            }
          />
        ) : (
          GROUPS.map((g) => {
            const own = rows.filter((r) => r.row.group === g.key);
            if (own.length === 0) return null;
            const t = periodTotals(own, asOf);
            return (
              <DataTable
                key={g.key}
                title={`${g.title} (${own.length})`}
                columns={columns(period, annual)}
                rows={own}
                rowKey={(r) => r.row.asset.id}
                sort={sort}
                sortHref={sortHref}
                footer={
                  <tr>
                    <td className="l">Total</td>
                    <td className="r">
                      <Amount>{formatAmount(t.value)}</Amount>
                    </td>
                    <td className="r">
                      <Amount>{formatAmount(t.invested)}</Amount>
                    </td>
                    {figures(t).slice(0, annual ? 3 : 2).map((cell) => (
                      <td key={cell.key} className="r">
                        {cell}
                      </td>
                    ))}
                  </tr>
                }
              />
            );
          })
        )}
      </div>

      <p className="footnote">
        All amounts in ₹. Gain in period is the value at the end, plus money taken out, minus the
        value at the start and money put in. % absolute divides it by the starting value plus money
        put in. % p.a. (XIRR) needs a year or more of history.
      </p>
    </div>
  );
}
