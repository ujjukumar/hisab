import Link from 'next/link';
import { IconLink } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  NameCell,
  tableStyles,
  tableSortFromParams,
  type Column,
} from '@/components/DataTable/DataTable';
import {
  AddInvestmentButton,
  FetchPricesButton,
  HoldingRowMenu,
  UpdateValuesButton,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { SubTabs } from '@/components/SubTabs/SubTabs';
import { ReturnsCard } from '@/components/ReturnsCard/ReturnsCard';
import type { ReturnLine, ValueSeries } from '@/components/charts/ReturnChart';
import { ASSET_TYPE_LABELS, GROUPS, maskRef } from '@/lib/domain/assets';
import { today } from '@/lib/domain/dates';
import {
  formatAmount,
  formatAmountSigned,
  formatDate,
  formatPercentNoPlus,
  formatReturn,
  formatUnits,
  gainClass,
} from '@/lib/domain/format';
import { unitsAmount } from '@/lib/domain/holdings';
import type { Paise } from '@/lib/domain/money';
import {
  PERIOD_LABELS,
  PERIODS,
  investmentPeriodRows,
  periodTotals,
  type Period,
  type PeriodRow,
} from '@/lib/domain/performance';
import { totals, type HoldingRow } from '@/lib/domain/portfolio';
import { RETURN_RANGES, benchmarkReturns, pickReturnRange, returnSeries } from '@/lib/domain/returns';
import { benchmarkHistory, benchmarkList, benchmarksMissingHistory } from '@/lib/queries/benchmarks';
import { assetOptions, pickHoldings, portfolio, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

type Group = (typeof GROUPS)[number];

const SORT_KEYS = [
  'name',
  'change',
  'changePercent',
  'cost',
  'costPerUnit',
  'value',
  'units',
  'share',
  'return',
  'returnRate',
] as const;

/** Price with two decimals, worked out with decimal maths rather than floats. */
const price = (p: string) => formatAmount(unitsAmount('1', p), 2);

const retTone = (r: HoldingRow['ret']) => gainClass((r?.rate ?? 0) * 100);

function columns(
  g: Group,
  portfolioValue: Paise,
  changeById: Map<number, PeriodRow>,
  period: Period,
): Column<HoldingRow>[] {
  const costSub =
    g.key === 'stock'
      ? 'Cost per share'
      : g.key === 'mf' || g.key === 'gold'
        ? 'Cost per unit'
        : 'Principal';
  return [
    {
      key: 'name',
      header: 'Name',
      sub: g.key === 'mf' || g.key === 'stock' ? 'Last price' : g.nameSub,
      align: 'l',
      sortable: true,
      sortValue: (r) => r.asset.name,
      cell: (r) => (
        <NameCell
          href={`/investments/${r.asset.id}${period === '1d' ? '' : `?period=${period}`}`}
          name={
            <>
              {r.asset.name}
              {r.asset.archived === 1 ? (
                <span className={tableStyles.tag}>Archived</span>
              ) : (
                r.sold && <span className={tableStyles.tag}>Sold</span>
              )}
            </>
          }
          sub={r.sold || r.asset.valuation !== 'units'
            ? maskRef(r.asset.accountRef) || ASSET_TYPE_LABELS[r.asset.type]
            : r.price
              ? `${price(r.price.price)} · ${formatDate(r.price.date)}`
              : r.holding.lastBuyPrice
                ? `${price(r.holding.lastBuyPrice)} · Price not updated`
                : 'Price not updated'}
        />
      ),
    },
    {
      key: 'change',
      header: 'Change in period',
      sortOptions: [
        {
          key: 'change',
          header: 'Change in period',
          sub: PERIOD_LABELS[period],
          sortValue: (r) => changeById.get(r.asset.id)?.gain ?? null,
        },
        {
          key: 'changePercent',
          header: '% change',
          sortValue: (r) => changeById.get(r.asset.id)?.absolute ?? null,
        },
      ],
      cell: (r) => {
        const change = changeById.get(r.asset.id);
        return change ? (
          <Amount
            tone={gainClass(change.gain)}
            sub={change.absolute === null ? undefined : formatPercentNoPlus(change.absolute * 100)}
            subTone={gainClass(change.gain)}
          >
            {formatAmountSigned(change.gain)}
          </Amount>
        ) : (
          null
        );
      },
    },
    {
      key: 'cost',
      header: 'Total cost',
      sortOptions: [
        {
          key: 'cost',
          header: 'Total cost',
          sortValue: (r) => r.sold ? null : r.holding.cost,
        },
        {
          key: 'costPerUnit',
          header: costSub,
          sortValue: (r) =>
            r.sold || r.asset.valuation !== 'units' || r.holding.units.isZero()
              ? null
              : r.holding.cost / r.holding.units.toNumber(),
        },
      ],
      cell: (r) =>
        r.sold ? (
          null
        ) : (
          <Amount
            sub={
              r.asset.valuation === 'units' && r.holding.units.gt(0)
                ? formatAmount(Math.round(r.holding.cost / r.holding.units.toNumber()), 2)
                : undefined
            }
          >
            {formatAmount(r.holding.cost)}
          </Amount>
        ),
    },
    {
      key: 'value',
      header: 'Current value',
      sortOptions: [
        {
          key: 'value',
          header: 'Current value',
          sortValue: (r) => r.value,
        },
        {
          key: 'units',
          header: 'Units',
          sortValue: (r) => r.asset.valuation === 'units' ? r.holding.units.toNumber() : null,
        },
      ],
      cell: (r) => (
        <Amount
          sub={
            r.asset.valuation === 'units' && !r.sold
              ? `${formatUnits(r.holding.units.toNumber(), r.holding.units.isInteger() ? 0 : 3)} ${g.unitWord}`
              : undefined
          }
        >
          {formatAmount(r.value)}
        </Amount>
      ),
    },
    {
      key: 'return',
      header: 'Total return',
      sortOptions: [
        {
          key: 'return',
          header: 'Total return',
          sortValue: (r) => r.totalReturn,
        },
        {
          key: 'returnRate',
          header: 'Return % p.a.',
          sortValue: (r) => r.ret?.rate ?? null,
        },
      ],
      cell: (r) => (
        <Amount
          tone={gainClass(r.totalReturn)}
          sub={r.sold ? `Realised, ${formatReturn(r.ret)}` : formatReturn(r.ret)}
          subTone={retTone(r.ret)}
        >
          {formatAmountSigned(r.totalReturn)}
        </Amount>
      ),
    },
    {
      key: 'share',
      header: '% of portfolio',
      sortable: true,
      sortValue: (r) => portfolioValue ? (r.value / portfolioValue) * 100 : 0,
      cell: (r) => (
        <Amount>{portfolioValue ? ((r.value / portfolioValue) * 100).toFixed(2) : '0.00'}</Amount>
      ),
    },
  ];
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const date = today();
  const all = portfolio(date);
  const { rows, showSold, group } = pickHoldings(all, params);
  const hiddenSold = all.filter((r) => r.sold).length;
  const portfolioValue = totals(all, date).value;
  const options = new Map(assetOptions().map((o) => [o.id, o]));
  const period = PERIODS.find((p) => p === params.period) ?? '1d';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') search.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
  }
  const sort = tableSortFromParams(search, SORT_KEYS);
  const yearStart = await financialYearStartMonth();
  const data = portfolioData();
  const scope = group ? {
    ...data,
    assets: data.assets.filter((asset) => all.some((row) => row.asset.id === asset.id && row.group === group)),
    txns: data.txns.filter((txn) => all.some((row) => row.asset.id === txn.assetId && row.group === group)),
  } : data;
  const first = scope.txns.reduce<string | null>((earliest, txn) =>
    earliest === null || txn.date < earliest ? txn.date : earliest, null);
  const range = first ? pickReturnRange({
    range: typeof params.range === 'string' ? params.range : undefined,
    from: typeof params.from === 'string' ? params.from : undefined,
    to: typeof params.to === 'string' ? params.to : undefined,
  }, date, first) : null;
  const points = range && !range.error ? returnSeries(scope, range.to, range.from) : [];
  const groups = GROUPS.filter(({ key }) => scope.assets.some((asset) =>
    all.some((row) => row.asset.id === asset.id && row.group === key) &&
    scope.txns.some((txn) => txn.assetId === asset.id)));
  const lines: ReturnLine[] = points.length ? [
    ...(!group && groups.length > 1 ? [{ key: 'portfolio', label: 'Portfolio', color: 'var(--c1)',
      values: points.map((point) => point.portfolio) }] : []),
    ...groups.map(({ key, title }, index) => ({ key, label: title,
      color: `var(--c${(index + (group ? 1 : 2)) % 8 + 1})`,
      values: points.map((point) => point.groups[key] ?? null) })),
  ] : [];
  const benchmarks = benchmarkList();
  const compared = new Set(typeof params.compare === 'string'
    ? params.compare.split(',').map(Number) : []);
  const selected = benchmarks.filter((item) => compared.has(item.id));
  const history = benchmarkHistory(selected.map((item) => item.id));
  const missingIds = new Set(benchmarksMissingHistory(selected.map((item) => item.id)));
  const missing = selected.filter((item) => missingIds.has(item.id)).map(({ id, name }) => ({ id, name }));
  const notices: string[] = [];
  const benchmarkWorth: ReturnLine[] = [];
  for (const [index, item] of selected.entries()) {
    const compared = benchmarkReturns(scope, points, range?.from ?? null,
      history.filter((row) => row.benchmarkId === item.id));
    if (compared.error) notices.push(`${item.name}: ${compared.error}`);
    const color = `var(--c${(index + 4) % 8 + 1})`;
    if (points.length) {
      lines.push({ key: `benchmark-${item.id}`, label: item.name, color, dashed: true, values: compared.values });
      benchmarkWorth.push({ key: `benchmark-${item.id}`, label: item.name, color, dashed: true, values: compared.worth });
    }
  }
  const value: ValueSeries | undefined = points.length ? {
    worth: points.map((point) => point.value),
    invested: points.map((point) => point.invested),
    percent: points.map((point) => point.invested > 0 ? (point.value - point.invested) / point.invested : null),
    gain: points.map((point) => point.gain),
    added: points.map((point) => point.added),
    booked: points.map((point) => point.booked),
    income: points.map((point) => point.income),
    gainPercent: points.map((point) => point.portfolio),
    rangeLabel: range?.range === 'all' ? 'All time' : range?.range === 'custom' ? 'In range'
      : RETURN_RANGES.find(([key]) => key === range?.range)?.[1] ?? '',
    benchmarks: benchmarkWorth,
  } : undefined;
  const changes = investmentPeriodRows(data, period, date, yearStart);
  const changeById = new Map(changes.map((r) => [r.row.asset.id, r]));

  const query = (next: { group?: string | null; sold?: boolean; sort?: string; dir?: 'asc' | 'desc' }) => {
    const p = new URLSearchParams();
    const g = next.group === undefined ? group : next.group;
    if (g) p.set('group', g);
    if (next.sold ?? showSold) p.set('sold', '1');
    if (period !== '1d') p.set('period', period);
    if (selected.length) p.set('compare', selected.map((item) => item.id).join(','));
    if (range && range.range !== '1y') p.set('range', range.range);
    if (range?.range === 'custom') {
      if (typeof params.from === 'string') p.set('from', params.from);
      if (typeof params.to === 'string') p.set('to', params.to);
    }
    const sortKey = next.sort ?? sort?.key;
    const sortDir = next.dir ?? sort?.dir;
    if (sortKey && sortDir) {
      p.set('sort', sortKey);
      p.set('dir', sortDir);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  const present = GROUPS.filter((g) => all.some((r) => r.group === g.key && (showSold || !r.sold)));
  const shown = present.filter((g) => !group || g.key === group);

  return (
    <>
      {present.length > 1 && (
        <SubTabs
          label="Investment groups"
          current={group ?? 'all'}
          items={[
            { key: 'all', label: 'All', href: `/investments${query({ group: null })}` },
            ...present.map((g) => ({
              key: g.key,
              label: g.title,
              href: `/investments${query({ group: g.key })}`,
            })),
          ]}
        />
      )}
      <div className="wrap page-body">
        {first && range && <ReturnsCard dates={points.map((point) => point.date)} lines={lines} value={value}
          range={range.range} available={range.available} from={range.from} to={range.to} asOf={date}
          first={first} error={range.error} params={params} benchmarks={benchmarks} notices={notices} missing={missing} />}
        {hiddenSold > 0 && (
          <p className="tbl-note">
            {showSold ? (
              <Link className="linkish" href={`/investments${query({ sold: false })}`}>
                Hide sold investments
              </Link>
            ) : (
              <>
                {hiddenSold === 1
                  ? '1 sold investment is hidden.'
                  : `${hiddenSold} sold investments are hidden.`}{' '}
                <Link className="linkish" href={`/investments${query({ sold: true })}`}>
                  Show sold investments
                </Link>
              </>
            )}
          </p>
        )}

        {shown.length === 0 ? (
          <DataTable
            title="Holdings"
            columns={columns(GROUPS[0]!, portfolioValue, changeById, period)}
            rows={[]}
            rowKey={(r) => r.asset.id}
            sort={sort}
            sortHref={(key, dir) => `/investments${query({ sort: key, dir })}`}
            empty={
              <>
                <p>
                  No investments yet. Add a fund, stock, deposit or anything else you hold to see
                  what it&apos;s worth.
                </p>
                <AddInvestmentButton />
                <p>
                  Or{' '}
                  <Link className="linkish" href="/investments/import">
                    import your Value Research transaction history
                  </Link>
                  .
                </p>
              </>
            }
          />
        ) : (
          <div className="stack">
            {shown.map((g) => {
              const groupRows = rows.filter((r) => r.group === g.key);
              const t = totals(groupRows, date);
              const groupIds = new Set(groupRows.map((r) => r.asset.id));
              const groupChange = periodTotals(changes.filter((r) => groupIds.has(r.row.asset.id)), date);
              const updatable = groupRows.filter((r) => !r.sold && r.asset.valuation !== 'fd');
              const priced = updatable.filter((r) => r.asset.valuation === 'units');
              const manual = updatable.filter((r) => r.asset.valuation === 'manual');
              return (
                <DataTable
                  key={g.key}
                  title={`${g.title} (${groupRows.length})`}
                  actions={
                    <>
                      <FetchPricesButton
                        ids={priced.map((r) => r.asset.id)}
                        label={`Fetch prices for ${g.title}`}
                      />
                      <UpdateValuesButton
                        ids={manual.map((r) => r.asset.id)}
                        label={`Update values for ${g.title}`}
                      />
                      <IconLink
                        icon="download"
                        label={`Download ${g.title} as CSV`}
                        href={`/api/export/investments${query({ group: g.key })}`}
                        download
                      />
                    </>
                  }
                  columns={columns(g, portfolioValue, changeById, period)}
                  rows={groupRows}
                  rowKey={(r) => r.asset.id}
                  sort={sort}
                  sortHref={(key, dir) => `/investments${query({ sort: key, dir })}`}
                  menu={(r) => {
                    const option = options.get(r.asset.id);
                    return option && <HoldingRowMenu asset={option} />;
                  }}
                  footer={
                    <tr>
                      <td className="l">Total</td>
                      <td className="r">
                        <Amount
                          tone={gainClass(groupChange.gain)}
                          sub={groupChange.absolute === null ? undefined : formatPercentNoPlus(groupChange.absolute * 100)}
                          subTone={gainClass(groupChange.gain)}
                        >
                          {formatAmountSigned(groupChange.gain)}
                        </Amount>
                      </td>
                      <td className="r">
                        <Amount>{formatAmount(t.invested)}</Amount>
                      </td>
                      <td className="r">
                        <Amount>{formatAmount(t.value)}</Amount>
                      </td>
                      <td className="r">
                        <Amount
                          tone={gainClass(t.totalReturn)}
                          sub={formatReturn(t.ret)}
                          subTone={retTone(t.ret)}
                        >
                          {formatAmountSigned(t.totalReturn)}
                        </Amount>
                      </td>
                      <td className="r">
                        <Amount>
                          {portfolioValue ? ((t.value / portfolioValue) * 100).toFixed(2) : '0.00'}
                        </Amount>
                      </td>
                      <td />
                    </tr>
                  }
                />
              );
            })}
          </div>
        )}
        <p className="footnote">
          All amounts in ₹. Total return is current value minus cost; sold investments show the gain
          they made. Change in period accounts for money added or withdrawn. Returns under a year
          are shown as an absolute percentage (abs.). Booked gains use average cost, so they can
          differ from a broker&apos;s capital gains statement, which uses first in, first out.
        </p>
      </div>
    </>
  );
}
