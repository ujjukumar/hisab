import Link from 'next/link';
import { spentAndSaved } from '@/app/money/stats';
import { BudgetBar } from '@/components/BudgetBar/BudgetBar';
import { ButtonLink, IconLink } from '@/components/Button/Button';
import { Card, MoreLink } from '@/components/Card/Card';
import { BarChart } from '@/components/charts/BarChart';
import { DonutSplit, type Slice } from '@/components/charts/Donut';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import {
  AddInvestmentButton,
  AddInvestmentLink,
  InvestmentDrawerProvider,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { MoversCard } from '@/components/MoversCard/MoversCard';
import { PageHead } from '@/components/PageHead/PageHead';
import { Rows, type Row } from '@/components/Rows/Rows';
import { NetWorthPeriodSelect } from '@/components/StatStrip/NetWorthPeriodSelect';
import stripStyles from '@/components/StatStrip/StatStrip.module.css';
import { SwitchCard } from '@/components/SwitchCard/SwitchCard';
import {
  AddTransactionButton,
  TransactionDrawerProvider,
} from '@/components/TransactionDrawer/TransactionDrawer';
import { ASSET_CLASS_LABELS, GROUPS } from '@/lib/domain/assets';
import {
  addMonths,
  currentMonth,
  endOfMonth,
  isValidMonth,
  monthLabel,
  SHORT_MONTHS,
  startOfMonth,
  type IsoMonth,
} from '@/lib/domain/dates';
import {
  formatDate,
  formatDay,
  formatINR,
  formatINRSigned,
  formatPercent,
  formatReturn,
  formatShortINR,
  gainClass,
  MINUS,
} from '@/lib/domain/format';
import {
  investmentPeriodRows,
  linePoints,
  performanceSeries,
  seriesCadence,
  PERIOD_LABELS,
  periodRows,
  PERIODS,
  periodStart,
  periodTotals,
  type Period,
  type PeriodRow,
} from '@/lib/domain/performance';
import { totals, type HoldingRow } from '@/lib/domain/portfolio';
import { ACCOUNT_TYPE_LABELS } from '@/lib/validation/money';
import { monthBudgets } from '@/lib/queries/budgets';
import { assetOptions, portfolio, portfolioData } from '@/lib/queries/investments';
import {
  asOfDate,
  listAccounts,
  listCategories,
  listTransactions,
  monthlyTotals,
  moneyStrip,
  parseTxnFilters,
  spendingBreakdown,
  type Params,
  paramReader,
} from '@/lib/queries/money';
import { defaultCompounding, financialYearStartMonth } from '@/lib/queries/settings';
import styles from './page.module.css';

const color = (i: number) => `var(--c${(i % 8) + 1})`;

const NET_WORTH_PERIODS = [
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
] as const;

const slices = (items: { name: string; value: number; color: string | null }[]): Slice[] =>
  items.map((item, i) => ({
    name: item.name,
    value: item.value,
    color: item.color ? `var(--${item.color})` : color(i),
  }));

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const now = currentMonth();
  const params = paramReader(await searchParams);
  const asked = params.one('month');
  const netWorthPeriod = NET_WORTH_PERIODS.find((p) => p.value === params.one('worth')) ?? NET_WORTH_PERIODS[0];
  // Future months have nothing to show yet, so they fall back to this month.
  const month: IsoMonth = isValidMonth(asked) && asked <= now ? asked : now;
  const isNow = month === now;
  const asOf = asOfDate(month);
  const monthName = monthLabel(month).split(' ')[0]!;
  const range = { from: startOfMonth(month), to: endOfMonth(month) };
  const moneyHref = isNow ? '/money' : `/money?from=${range.from}&to=${range.to}`;
  const budgetsHref = isNow ? '/money/budgets' : `/money/budgets?month=${month}`;
  const monthHref = (m: IsoMonth) => {
    const query = new URLSearchParams();
    if (m !== now) query.set('month', m);
    if (netWorthPeriod.value !== '1d') query.set('worth', netWorthPeriod.value);
    return query.size ? `/?${query}` : '/';
  };

  const s = moneyStrip(month);
  const allAccounts = listAccounts(asOf);
  const accounts = allAccounts.filter((a) => !a.archived);
  const rows = portfolio(asOf);
  const data = portfolioData();
  const t = totals(rows, asOf);
  const worthFrom = periodStart(netWorthPeriod.value, asOf, 1)!;
  const earlierCash = listAccounts(worthFrom)
    .filter((account) => !account.archived)
    .reduce((sum, account) => sum + account.balance, 0);
  const earlierInvestments = portfolio(worthFrom).reduce((sum, row) => sum + row.value, 0);
  const calendarInvestmentGain = netWorthPeriod.value === '1d'
    ? periodTotals(periodRows(data, worthFrom, asOf), asOf).gain
    : 0;
  const latestPriceGain = netWorthPeriod.value === '1d'
    ? periodTotals(investmentPeriodRows(data, '1d', asOf, 1), asOf).gain
    : 0;
  const worthChange = s.bankAndCash + t.value - earlierCash - earlierInvestments
    + latestPriceGain - calendarInvestmentGain;
  const options = assetOptions();

  /* ---------- get started, for a brand-new app ---------- */
  const steps = [
    {
      title: 'Add an account',
      text: 'Your bank accounts, cards and cash, each with its balance today.',
      done: accounts.length > 0,
      action: (
        <ButtonLink href="/money/accounts" icon="plus">
          Add account
        </ButtonLink>
      ),
    },
    {
      title: 'Add a transaction',
      text: 'Record what you spend and earn. Budgets and reports are built from these.',
      done: allAccounts.some((a) => a.transactionCount > 0),
      action: <AddTransactionButton />,
    },
    {
      title: 'Add an investment',
      text: 'Mutual funds, stocks, deposits, gold or anything else you hold.',
      done: options.length > 0,
      action: <AddInvestmentButton />,
    },
  ];

  /* ---------- income vs spending ---------- */
  const months = monthlyTotals(addMonths(month, -11), month);
  const firstActive = months.findIndex((m) => m.income || m.spending);
  const bars = (firstActive < 0 ? [] : months.slice(firstActive)).map((m) => ({
    month: SHORT_MONTHS[Number(m.month.slice(5)) - 1]!,
    year: m.month.slice(0, 4),
    income: m.income,
    spending: m.spending,
  }));
  const cashChart = (n: number) => (
    <>
      <LegendInline>
        <LegendKey color="var(--c1)">Income</LegendKey>
        <LegendKey color="var(--c3)">Spending</LegendKey>
      </LegendInline>
      <BarChart rows={bars.slice(-n)} />
    </>
  );

  /* ---------- where the money went ---------- */
  const spend = spendingBreakdown(month);
  const spendSplit = (items: Slice[]) =>
    items.length ? (
      <DonutSplit items={items} label={`Spending in ${monthLabel(month)}`} />
    ) : (
      <p className={styles.empty}>
        No spending in {monthName} yet. Add a transaction to see where your money goes.
      </p>
    );

  /* ---------- portfolio performance ---------- */
  const perfChart = (period: Period) => {
    const start = periodStart(period, asOf, 1);
    const points = performanceSeries(portfolioData(), asOf, start);
    return (
      <>
        <LegendInline>
          <LegendKey color="var(--c1)">Amount invested</LegendKey>
          <LegendKey color="var(--c2)">Current worth</LegendKey>
        </LegendInline>
        <LineChart points={linePoints(points, seriesCadence(start, asOf))} />
      </>
    );
  };

  /* ---------- allocation ---------- */
  const held = rows.filter((r) => r.value > 0);
  const sumBy = (key: (r: HoldingRow) => string, labels: { key: string; title: string }[]) =>
    labels
      .map((l, i) => ({
        name: l.title,
        value: held.filter((r) => key(r) === l.key).reduce((sum, r) => sum + r.value, 0),
        color: color(i),
      }))
      .filter((item) => item.value > 0);
  const byClass = sumBy(
    (r) => r.asset.assetClass,
    Object.entries(ASSET_CLASS_LABELS).map(([key, title]) => ({ key, title })),
  );
  const byGroup = sumBy((r) => r.group, GROUPS);
  const allocSplit = (items: Slice[]) =>
    items.length ? (
      <DonutSplit items={items} label="Portfolio allocation" />
    ) : (
      <div className={styles.empty}>
        <p>No investments yet. Add one to see how your money is spread.</p>
        <AddInvestmentButton />
      </div>
    );

  /* ---------- budgets ---------- */
  const b = monthBudgets(month);

  /* ---------- recent transactions ---------- */
  const recent = listTransactions({ ...parseTxnFilters({}), ...range, limit: 6 }).rows;
  const categoryColor = new Map(listCategories().map((c) => [c.id, c.color]));
  const recentRows: Row[] = recent.map((r) => ({
    key: String(r.id),
    name: r.description,
    sub: `${formatDay(r.date)}, ${r.type === 'transfer' ? `to ${r.toAccountName ?? ''}` : (r.accountName ?? '')}`,
    color:
      r.type === 'transfer' || !r.categoryId
        ? 'var(--c-muted)'
        : `var(--${categoryColor.get(r.categoryId) ?? 'c-muted'})`,
    amount:
      r.type === 'income'
        ? `+${formatINR(r.amount)}`
        : r.type === 'expense'
          ? `${MINUS}${formatINR(r.amount)}`
          : formatINR(r.amount),
    tone: r.type === 'income' ? 'pos' : r.type === 'transfer' ? 'muted' : '',
  }));

  /* ---------- returns over each period, for the two cards below ---------- */
  const yearStart = await financialYearStartMonth();
  const byPeriod = PERIODS.map((period) => {
    const from = period === '1d' ? null : periodStart(period, asOf, yearStart);
    return {
      period,
      from,
      rows: investmentPeriodRows(data, period, asOf, yearStart),
    };
  });

  /* ---------- returns by investment type ---------- */
  const returnRows = (mode: Period, periodRowsOf: PeriodRow[]): Row[] =>
    GROUPS.map((g) => {
      const own = rows.filter((r) => r.group === g.key);
      if (own.length === 0) {
        return {
          key: g.key,
          name: g.title,
          amount: (
            <span className="muted">
              Not added · <AddInvestmentLink label={`Add ${g.title}`} />
            </span>
          ),
        };
      }
      const gt = totals(own, asOf);
      if (mode !== 'all') {
        const mine = periodRowsOf.filter((r) => r.row.group === g.key);
        if (mine.length === 0) {
          return { key: g.key, name: g.title, amount: 'Not held in this period', tone: 'muted' };
        }
        const pt = periodTotals(mine, asOf);
        const pct = pt.absolute === null ? '—' : formatPercent(pt.absolute * 100);
        return {
          key: g.key,
          name: g.title,
          amount: `${formatINRSigned(pt.gain)} (${pct})`,
          tone: gainClass(pt.gain),
        };
      }
      return {
        key: g.key,
        name: g.title,
        amount: `${formatINRSigned(gt.allTime)} (${formatReturn(gt.ret)})`,
        tone: gainClass(gt.allTime),
      };
    });

  /* ---------- gainers and losers ---------- */
  const movers = Object.fromEntries(
    byPeriod.map(({ period, rows: periodRowsOf }) => [
      period,
      periodRowsOf
        .filter((r) => !r.row.sold && r.gain !== 0)
        .map((r) => ({
          id: r.row.asset.id,
          name: r.row.asset.name,
          group: r.row.group,
          gain: r.gain,
          percent: (r.absolute ?? 0) * 100,
        })),
    ]),
  );
  const moverPeriods = byPeriod.map(({ period, from }) => ({
    value: period,
    label: PERIOD_LABELS[period],
    sub: period === '1d'
      ? 'Latest daily prices per holding, after money added or taken out'
      : from
        ? `Gain from ${formatDate(from)} to ${formatDate(asOf)}, after money added or taken out`
        : 'Gain since each holding was bought',
  }));

  return (
    <TransactionDrawerProvider
      accounts={allAccounts.map(({ id, name, archived }) => ({ id, name, archived }))}
      categories={listCategories()}
    >
      <InvestmentDrawerProvider
        options={options}
        accounts={allAccounts.map(({ id, name, archived }) => ({ id, name, archived }))}
        compounding={await defaultCompounding()}
      >
        <PageHead
          title={monthLabel(month)}
          actions={
            <>
              <nav className={styles.months} aria-label="Month">
                <IconLink
                  icon="chevLeft"
                  label={`Previous month, ${monthLabel(addMonths(month, -1))}`}
                  href={monthHref(addMonths(month, -1))}
                />
                {!isNow && (
                  <>
                    <IconLink
                      icon="chevRight"
                      label={`Next month, ${monthLabel(addMonths(month, 1))}`}
                      href={monthHref(addMonths(month, 1))}
                    />
                    <Link className="linkish" href={monthHref(now)}>
                      This month
                    </Link>
                  </>
                )}
              </nav>
              <AddTransactionButton />
            </>
          }
          stats={[
            {
              label: isNow ? 'Net worth' : `Net worth on ${formatDay(asOf)}`,
              value: formatShortINR(s.bankAndCash + t.value),
              aside: (
                <span className={stripStyles.periodChange}>
                  <span>{formatINRSigned(worthChange)}</span>
                  <span className={stripStyles.periodGroup}>
                    over <NetWorthPeriodSelect period={netWorthPeriod.value} options={NET_WORTH_PERIODS} />
                  </span>
                </span>
              ),
              asideTone: gainClass(worthChange),
            },
            {
              label: 'Investments',
              value: formatShortINR(t.value),
              aside: `${formatShortINR(t.invested)} invested`,
            },
            ...spentAndSaved(s),
          ]}
        />

        <div className="wrap page-body">
          <div className="grid">
            {steps.some((step) => !step.done) && (
              <Card
                span={12}
                title="Get started"
                sub="Three steps and the dashboard fills itself in. Everything stays on this computer."
              >
                <ol className={styles.steps}>
                  {steps.map((step) => (
                    <li key={step.title} className={step.done ? styles.done : undefined}>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.text}</p>
                      </div>
                      {step.done ? <span className={styles.check}>Done</span> : step.action}
                    </li>
                  ))}
                </ol>
                <p className="footnote">
                  Moving from another computer?{' '}
                  <Link className="linkish" href="/settings">
                    Restore a backup in Settings
                  </Link>
                  .
                </p>
              </Card>
            )}
            <SwitchCard
              id="cash-range"
              label="Time range"
              title="Income vs spending"
              sub="What came in and went out each month"
              span={8}
              options={[
                { value: '6', label: '6M', content: cashChart(6) },
                { value: '12', label: '1Y', content: cashChart(12) },
              ]}
              footer={<MoreLink href={moneyHref}>See all transactions</MoreLink>}
            />

            <SwitchCard
              id="spend-by"
              label="Group spending by"
              title="Where your money went"
              sub={`${formatINR(s.spending)} spent ${isNow ? 'so far this month' : `in ${monthName}`}`}
              span={4}
              options={[
                {
                  value: 'cat',
                  label: 'By category',
                  content: spendSplit(slices(spend.byCategory)),
                },
                {
                  value: 'acct',
                  label: 'By account',
                  content: spendSplit(slices(spend.byAccount)),
                },
              ]}
              footer={<MoreLink href={budgetsHref}>See budgets</MoreLink>}
            />

            <SwitchCard
              id="perf-range"
              label="Time range"
              title="Portfolio performance"
              sub="Amount invested against current worth, with detail to match the range. YTD starts on 1 January."
              span={8}
              options={(
                [
                  ['all', 'All time'],
                  ['ytd', 'YTD'],
                  ['6m', '6M'],
                  ['1y', '1Y'],
                  ['3y', '3Y'],
                ] as const
              ).map(([value, label]) => ({ value, label, content: perfChart(value) }))}
              footer={<MoreLink href="/investments/performance">See performance details</MoreLink>}
            />

            <SwitchCard
              id="alloc-by"
              label="Group allocation by"
              title="Allocation"
              span={4}
              options={[
                { value: 'asset', label: 'By asset', content: allocSplit(byClass) },
                { value: 'type', label: 'By investment type', content: allocSplit(byGroup) },
              ]}
              footer={<MoreLink href="/investments">See all holdings</MoreLink>}
            />

            <Card
              title="Budgets"
              sub={
                !b.budget ? (
                  `No budgets set for ${monthName}`
                ) : b.over ? (
                  <>
                    <span className="neg">{formatINR(-b.left)} over</span> your{' '}
                    {formatINR(b.budget)} budget
                  </>
                ) : (
                  `${formatINR(b.left)} left of ${formatINR(b.budget)} ${isNow ? 'this month' : `in ${monthName}`}`
                )
              }
              span={4}
              className="half"
              footer={<MoreLink href={budgetsHref}>Manage budgets</MoreLink>}
            >
              {b.rows.length ? (
                <div className={styles.budgets}>
                  {b.rows.map((r) => (
                    <BudgetBar key={r.id} name={r.name} spent={r.spent} budget={r.budget} />
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>Set a monthly budget to see how spending compares.</p>
              )}
            </Card>

            <Card
              title="Recent transactions"
              span={4}
              className="half"
              footer={<MoreLink href={moneyHref}>See all transactions</MoreLink>}
            >
              {recentRows.length ? (
                <Rows rows={recentRows} />
              ) : (
                <div className={styles.empty}>
                  <p>No transactions in {monthName} yet.</p>
                  <AddTransactionButton />
                </div>
              )}
            </Card>

            <SwitchCard
              id="returns-duration"
              variant="select"
              label="Duration"
              title="Returns by investment type"
              span={4}
              options={byPeriod.map(({ period, rows: periodRowsOf }) => ({
                value: period,
                label: PERIOD_LABELS[period],
                content: <Rows rows={returnRows(period, periodRowsOf)} />,
              }))}
              footer={<MoreLink href="/investments">See all holdings</MoreLink>}
            />

            <MoversCard
              movers={movers}
              periods={moverPeriods}
              groups={GROUPS.filter((g) =>
                Object.values(movers).some((list) => list.some((m) => m.group === g.key)),
              )}
            />

            <Card
              title="Accounts"
              sub={isNow ? 'Bank, card and cash balances' : `Balances on ${formatDate(asOf)}`}
              span={5}
              footer={<MoreLink href="/money/accounts">Manage accounts</MoreLink>}
            >
              <Rows
                rows={[
                  ...accounts.map((a) => ({
                    key: String(a.id),
                    name: a.name,
                    sub: [ACCOUNT_TYPE_LABELS[a.type], a.note].filter(Boolean).join(', '),
                    amount: formatINR(a.balance),
                  })),
                  {
                    key: 'total',
                    name: 'In bank and cash',
                    amount: formatINR(s.bankAndCash),
                    total: true,
                  },
                ]}
              />
            </Card>
          </div>
        </div>
      </InvestmentDrawerProvider>
    </TransactionDrawerProvider>
  );
}
