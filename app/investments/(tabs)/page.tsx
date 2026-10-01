import Link from 'next/link';
import { IconLink } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  NameCell,
  tableStyles,
  type Column,
} from '@/components/DataTable/DataTable';
import {
  AddInvestmentButton,
  HoldingRowMenu,
  UpdatePricesButton,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { SubTabs } from '@/components/SubTabs/SubTabs';
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
import { assetOptions, pickHoldings, portfolio, portfolioData } from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

type Group = (typeof GROUPS)[number];

const MUTED = <Amount tone="muted">—</Amount>;

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
      sub: g.nameSub,
      align: 'l',
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
          sub={maskRef(r.asset.accountRef) || ASSET_TYPE_LABELS[r.asset.type]}
        />
      ),
    },
    {
      key: 'price',
      header: 'Last price',
      sub: 'As of',
      cell: (r) =>
        r.sold || r.asset.valuation !== 'units' ? (
          MUTED
        ) : r.price ? (
          <Amount sub={formatDate(r.price.date)}>{price(r.price.price)}</Amount>
        ) : (
          <Amount sub="Price not updated">
            {r.holding.lastBuyPrice ? price(r.holding.lastBuyPrice) : '—'}
          </Amount>
        ),
    },
    {
      key: 'change',
      header: 'Change in period',
      sub: PERIOD_LABELS[period],
      cell: (r) => {
        const change = changeById.get(r.asset.id);
        return change ? (
          <Amount
            tone={gainClass(change.gain)}
            sub={change.absolute === null ? '—' : formatPercentNoPlus(change.absolute * 100)}
            subTone={gainClass(change.gain)}
          >
            {formatAmountSigned(change.gain)}
          </Amount>
        ) : (
          MUTED
        );
      },
    },
    {
      key: 'cost',
      header: 'Total cost',
      sub: costSub,
      cell: (r) =>
        r.sold ? (
          MUTED
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
      sub: g.key === 'mf' || g.key === 'stock' || g.key === 'gold' ? g.unitWord : undefined,
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
      key: 'share',
      header: '% of portfolio',
      cell: (r) => (
        <Amount>{portfolioValue ? ((r.value / portfolioValue) * 100).toFixed(2) : '0.00'}</Amount>
      ),
    },
    {
      key: 'return',
      header: 'Total return',
      sub: 'Return % p.a.',
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
  const yearStart = await financialYearStartMonth();
  const data = portfolioData();
  const changes = investmentPeriodRows(data, period, date, yearStart);
  const changeById = new Map(changes.map((r) => [r.row.asset.id, r]));

  const query = (next: { group?: string | null; sold?: boolean }) => {
    const p = new URLSearchParams();
    const g = next.group === undefined ? group : next.group;
    if (g) p.set('group', g);
    if (next.sold ?? showSold) p.set('sold', '1');
    if (period !== '1d') p.set('period', period);
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
              const pricesOnly = updatable.every((r) => r.asset.valuation === 'units');
              return (
                <DataTable
                  key={g.key}
                  title={`${g.title} (${groupRows.length})`}
                  actions={
                    <>
                      <UpdatePricesButton
                        ids={updatable.map((r) => r.asset.id)}
                        label={`${pricesOnly ? 'Update prices' : 'Update values'} for ${g.title}`}
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
                  menu={(r) => {
                    const option = options.get(r.asset.id);
                    return option && <HoldingRowMenu asset={option} />;
                  }}
                  footer={
                    <tr>
                      <td className="l">Total</td>
                      <td />
                      <td className="r">
                        <Amount
                          tone={gainClass(groupChange.gain)}
                          sub={groupChange.absolute === null ? '—' : formatPercentNoPlus(groupChange.absolute * 100)}
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
                        <Amount>
                          {portfolioValue ? ((t.value / portfolioValue) * 100).toFixed(2) : '0.00'}
                        </Amount>
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
          are shown as an absolute percentage (abs.).
        </p>
      </div>
    </>
  );
}
