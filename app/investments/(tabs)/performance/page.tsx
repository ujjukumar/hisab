import { ButtonLink } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import { Amount, DataTable, NameCell, type Column } from '@/components/DataTable/DataTable';
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
  type PeriodResult,
  type PeriodRow,
} from '@/lib/domain/performance';
import { periodPerformance, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

const percent = (rate: number | null) => (rate === null ? '—' : formatPercent(rate * 100, 1));

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

const columns: Column<PeriodRow>[] = [
  {
    key: 'name',
    header: 'Name',
    align: 'l',
    cell: ({ row }) => (
      <NameCell
        href={`/investments/${row.asset.id}`}
        name={row.asset.name}
        sub={maskRef(row.asset.accountRef) || ASSET_TYPE_LABELS[row.asset.type]}
      />
    ),
  },
  {
    key: 'value',
    header: 'Current value',
    cell: ({ row }) => <Amount>{formatAmount(row.value)}</Amount>,
  },
  {
    key: 'invested',
    header: 'Invested',
    cell: ({ row }) => <Amount>{formatAmount(row.sold ? 0 : row.holding.cost)}</Amount>,
  },
  ...(['Gain in period', '% absolute', '% p.a.'] as const).map((header, i) => ({
    key: header,
    header,
    cell: (r: PeriodRow) => figures(r)[i],
  })),
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
  const series = performanceSeries(portfolioData(), asOf);
  const shown = linePoints(series.filter((p) => !from || p.date > from));
  const query = new URLSearchParams({ asof: asOf, period }).toString();

  const span =
    period === 'since'
      ? "Each holding's change since its previous price"
      : from
        ? `${formatDate(addDays(from, 1))} to ${formatDate(asOf)}`
        : `All time to ${formatDate(asOf)}`;

  return (
    <div className="wrap page-body">
      <FilterForm
        path="/investments/performance"
        label="Choose the period"
        values={{ asof: asOf, period }}
      >
        <TextField label="As of" name="asof" type="date" max={today()} defaultValue={asOf} />
        <SelectField label="Period" name="period" defaultValue={period}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </SelectField>
      </FilterForm>

      <div className="stack">
        <Card
          title={`Returns, ${PERIOD_LABELS[period].toLowerCase()}`}
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
          sub={
            period === 'since' || !from
              ? 'At each month-end, all time'
              : `At each month-end from ${formatDate(addDays(from, 1))}`
          }
        >
          <LegendInline>
            <LegendKey color="var(--c1)">Amount invested</LegendKey>
            <LegendKey color="var(--c2)">Current worth</LegendKey>
          </LegendInline>
          <LineChart points={period === 'since' ? linePoints(series) : shown} />
        </Card>

        {rows.length === 0 ? (
          <DataTable
            title="Holdings"
            columns={columns}
            rows={[]}
            rowKey={(r) => r.row.asset.id}
            empty={
              period === 'since' ? (
                <p>No holding has two prices by this date. Update prices to see the change.</p>
              ) : (
                <>
                  <p>No investments in this period. Add one to start tracking its returns.</p>
                  <AddInvestmentButton />
                </>
              )
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
                columns={columns}
                rows={own}
                rowKey={(r) => r.row.asset.id}
                footer={
                  <tr>
                    <td className="l">Total</td>
                    <td className="r">
                      <Amount>{formatAmount(t.value)}</Amount>
                    </td>
                    <td className="r">
                      <Amount>{formatAmount(t.invested)}</Amount>
                    </td>
                    {figures(t).map((cell) => (
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
        {period === 'since' && ' Since last update covers holdings with two or more prices.'}
      </p>
    </div>
  );
}
