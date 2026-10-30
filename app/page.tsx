import Link from 'next/link';
import { NeedsYou } from '@/components/AttentionStrip/AttentionStrip';
import { BudgetBar } from '@/components/BudgetBar/BudgetBar';
import { ButtonLink } from '@/components/Button/Button';
import { Card, MoreLink } from '@/components/Card/Card';
import { ChipLinks } from '@/components/Chips/Chips';
import { LineChart } from '@/components/charts/LineChart';
import { PaceChart } from '@/components/charts/PaceChart';
import {
  AddInvestmentButton,
  InvestmentDrawerProvider,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { PageHead } from '@/components/PageHead/PageHead';
import { Rows, type Row } from '@/components/Rows/Rows';
import {
  AddTransactionButton,
  TransactionDrawerProvider,
} from '@/components/TransactionDrawer/TransactionDrawer';
import { WealthBridge } from '@/components/WealthBridge/WealthBridge';
import { attentionItems, nextDueDate } from '@/lib/domain/attention';
import {
  addMonths,
  currentMonth,
  daysInMonth,
  monthLabel,
  parts,
  today,
} from '@/lib/domain/dates';
import {
  formatDate,
  formatDay,
  formatINR,
  formatINRSigned,
  formatPercent,
  formatShortINR,
  gainClass,
  MINUS,
} from '@/lib/domain/format';
import {
  investmentPeriodRows,
  linePoints,
  netWorthSeries,
  PERIOD_LABELS,
  periodRows,
  periodStart,
  periodTotals,
  seriesCadence,
  type Period,
} from '@/lib/domain/performance';
import { totals } from '@/lib/domain/portfolio';
import { feedAssets } from '@/lib/domain/priceFeeds';
import { monthBudgets } from '@/lib/queries/budgets';
import { assetOptions, portfolio, portfolioData } from '@/lib/queries/investments';
import {
  allFlows,
  dailySpending,
  listAccounts,
  listCategories,
  listTransactions,
  moneyStrip,
  paramReader,
  parseTxnFilters,
  type Params,
} from '@/lib/queries/money';
import { pendingSmsCount } from '@/lib/queries/sms';
import {
  autoPrices,
  defaultCompounding,
  financialYearStartMonth,
  priceUpdate,
} from '@/lib/queries/settings';
import { ACCOUNT_TYPE_LABELS } from '@/lib/validation/money';
import styles from './page.module.css';

/** The page's one period control. A week suits checking in a few times a week. */
const PAGE_PERIODS = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
] as const satisfies readonly { value: Period; label: string }[];
const DEFAULT_PERIOD = '1w';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = paramReader(await searchParams);
  const period: Period =
    PAGE_PERIODS.find((p) => p.value === params.one('period'))?.value ?? DEFAULT_PERIOD;
  const asOf = today();
  const month = currentMonth();
  const monthName = monthLabel(month).split(' ')[0]!;
  const lastMonth = addMonths(month, -1);
  const yearStart = await financialYearStartMonth();

  const s = moneyStrip(month);
  const allAccounts = listAccounts(asOf);
  const accounts = allAccounts.filter((a) => !a.archived);
  const rows = portfolio(asOf);
  const data = portfolioData();
  const t = totals(rows, asOf);
  const options = assetOptions();
  const choices = allAccounts.map(({ id, name, archived }) => ({ id, name, archived }));

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

  /* ---------- wealth: how net worth moved over the period ---------- */
  const worthFrom = periodStart(period, asOf, 1)!;
  const earlierCash = listAccounts(worthFrom)
    .filter((account) => !account.archived && account.openingDate <= worthFrom)
    .reduce((sum, account) => sum + account.balance, 0);
  const earlierInvestments = portfolio(worthFrom).reduce((sum, row) => sum + row.value, 0);
  const periodRowsNow = investmentPeriodRows(data, period, asOf, yearStart);
  const market = periodTotals(periodRowsNow, asOf).gain;
  // For one day, investments move on each holding's last two prices, not on calendar dates.
  const calendarInvestmentGain =
    period === '1d' ? periodTotals(periodRows(data, worthFrom, asOf), asOf).gain : 0;
  const netWorth = s.bankAndCash + t.value;
  const worthChange =
    netWorth - earlierCash - earlierInvestments + (period === '1d' ? market : 0) - calendarInvestmentGain;

  // A one-day line has two points, so the chart shows at least a week.
  const chartFrom = periodStart(period === '1d' ? '1w' : period, asOf, 1);
  const worthPoints = netWorthSeries(data, allAccounts, allFlows(), asOf, chartFrom).map((point) => ({
    date: point.date,
    invested: point.accounts,
    worth: point.worth,
  }));

  const moved = periodRowsNow.filter((r) => !r.row.sold && r.gain !== 0);
  const moverRow = (r: (typeof moved)[number]): Row => ({
    key: String(r.row.asset.id),
    name: <Link href={`/investments/${r.row.asset.id}`}>{r.row.asset.name}</Link>,
    amount:
      r.absolute === null
        ? formatINRSigned(r.gain)
        : `${formatINRSigned(r.gain)} (${formatPercent(r.absolute * 100)})`,
    tone: gainClass(r.gain),
  });
  const up = moved.filter((r) => r.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const down = moved.filter((r) => r.gain < 0).sort((a, b) => a.gain - b.gain).slice(0, 3);

  /* ---------- needs you ---------- */
  const b = monthBudgets(month);
  const lastPrices = await priceUpdate();
  const attention = steps.some((step) => step.done)
    ? attentionItems({
        today: asOf,
        month,
        isCurrentMonth: true,
        budgets: b,
        accounts: allAccounts,
        holdings: rows.map((r) => ({ name: r.asset.name, stale: r.stale, sold: r.sold })),
        prices: {
          lastOn: lastPrices?.on ?? null,
          ok: lastPrices?.ok ?? false,
          // Nothing to fetch without an ISIN, so there is nothing to nudge about.
          auto:
            (await autoPrices()) &&
            feedAssets(rows.filter((r) => !r.sold).map((r) => r.asset)).length > 0,
        },
        sms: { pending: pendingSmsCount() },
      })
    : [];
  const payFrom = accounts.find((a) => a.type === 'bank')?.id ?? null;

  /* ---------- this month so far ---------- */
  const { year, month: m, day } = parts(asOf);
  const monthDays = daysInMonth(year, m);
  const daysLeft = monthDays - day + 1;
  const left = b.budget - s.spending;
  const closest = b.rows
    .filter((r) => r.budget > 0)
    .sort((x, y) => y.spent / y.budget - x.spent / x.budget)
    .slice(0, 5);

  /* ---------- accounts and cards ---------- */
  const hasCards = accounts.some((a) => a.type === 'card');
  const accountRows: Row[] = [
    ...accounts.map((a) => ({
      key: String(a.id),
      name: a.name,
      sub:
        a.type === 'card' && a.dueDay
          ? `${ACCOUNT_TYPE_LABELS[a.type]}, bill due ${formatDay(nextDueDate(asOf, a.dueDay))}`
          : ACCOUNT_TYPE_LABELS[a.type],
      amount: formatINR(a.balance),
    })),
    {
      key: 'total',
      name: hasCards ? 'Total after card bills' : 'Total',
      amount: formatINR(s.bankAndCash),
      total: true,
    },
  ];

  /* ---------- latest transactions ---------- */
  const categoryColor = new Map(listCategories().map((c) => [c.id, c.color]));
  const latest: Row[] = listTransactions({
    ...parseTxnFilters({}),
    from: '1900-01-01',
    to: asOf,
    limit: 5,
  }).rows.map((r) => ({
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

  return (
    <TransactionDrawerProvider accounts={choices} categories={listCategories()}>
      <InvestmentDrawerProvider
        options={options}
        accounts={choices}
        compounding={await defaultCompounding()}
      >
        <PageHead
          title="Dashboard"
          sub={formatDate(asOf)}
          actions={
            <>
              <ChipLinks
                label="Period"
                items={PAGE_PERIODS.map((p) => ({
                  href: p.value === DEFAULT_PERIOD ? '/' : `/?period=${p.value}`,
                  label: p.label,
                  current: p.value === period,
                }))}
              />
              <AddTransactionButton />
            </>
          }
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

            <Card span={8} title="Net worth" footer={<MoreLink href="/investments">See investments</MoreLink>}>
              <div className={styles.worth}>
                <strong className={styles.worthValue}>{formatShortINR(netWorth)}</strong>
                <span className={`${styles.worthChange} ${gainClass(worthChange)}`}>
                  {formatINRSigned(worthChange)}
                </span>
                <span className={styles.worthOver}>over {PERIOD_LABELS[period]}</span>
              </div>
              <WealthBridge
                start={netWorth - worthChange}
                market={market}
                end={netWorth}
                startLabel={formatDay(worthFrom)}
              />
              <LineChart
                mode="netWorth"
                compact
                points={linePoints(worthPoints, seriesCadence(chartFrom, asOf))}
              />
              {rows.length === 0 ? (
                <div className={styles.empty}>
                  <p>Add an investment to see what markets did to your money.</p>
                  <AddInvestmentButton />
                </div>
              ) : up.length + down.length > 0 ? (
                <div className={styles.moved}>
                  <section aria-labelledby="moved-up">
                    <h3 id="moved-up">Rose most</h3>
                    {up.length ? <Rows rows={up.map(moverRow)} /> : <p className={styles.none}>Nothing rose.</p>}
                  </section>
                  <section aria-labelledby="moved-down">
                    <h3 id="moved-down">Fell most</h3>
                    {down.length ? <Rows rows={down.map(moverRow)} /> : <p className={styles.none}>Nothing fell.</p>}
                  </section>
                </div>
              ) : (
                <p className={styles.none}>No holding moved over {PERIOD_LABELS[period]}.</p>
              )}
            </Card>

            <NeedsYou items={attention} payFrom={payFrom} />

            <Card
              span={12}
              title={`${monthName} so far`}
              footer={<MoreLink href="/money/budgets">Manage budgets</MoreLink>}
            >
              <dl className={styles.figures}>
                <div>
                  <dt>Spent</dt>
                  <dd>{formatINR(s.spending)}</dd>
                  <dd className={styles.figureSub}>
                    {b.budget ? `of ${formatINR(b.budget)} budget` : 'No budget set'}
                  </dd>
                </div>
                <div>
                  <dt>{left >= 0 ? 'Left to spend' : 'Over budget'}</dt>
                  <dd className={left < 0 ? 'neg' : undefined}>
                    {b.budget ? formatINR(Math.abs(left)) : 'No budget set'}
                  </dd>
                  <dd className={styles.figureSub}>
                    {b.budget && left > 0
                      ? `About ${formatINR(Math.floor(left / daysLeft))} a day for ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
                      : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in ${monthName}`}
                  </dd>
                </div>
                <div>
                  <dt>Earned</dt>
                  <dd>{formatINR(s.income)}</dd>
                </div>
                <div>
                  <dt>Saved</dt>
                  <dd className={gainClass(s.saved)}>{formatINR(s.saved)}</dd>
                  <dd className={styles.figureSub}>
                    {s.savingsRate === null ? 'No income yet' : `${Math.round(s.savingsRate)}% of income`}
                  </dd>
                </div>
              </dl>
              <div className={styles.month}>
                <section aria-labelledby="pace-title">
                  <h3 id="pace-title">Spending pace</h3>
                  <PaceChart
                    thisMonth={dailySpending(month).slice(0, day)}
                    lastMonth={dailySpending(lastMonth)}
                    daysInMonth={monthDays}
                    budget={b.budget}
                    thisLabel={monthName}
                    lastLabel={monthLabel(lastMonth).split(' ')[0]!}
                  />
                </section>
                <section aria-labelledby="closest-title">
                  <h3 id="closest-title">Closest to budget</h3>
                  {closest.length ? (
                    <div className={styles.budgets}>
                      {closest.map((r) => (
                        <BudgetBar key={r.id} name={r.name} spent={r.spent} budget={r.budget} />
                      ))}
                    </div>
                  ) : (
                    <div className={styles.empty}>
                      <p>Set a monthly budget to see how spending compares.</p>
                      <ButtonLink href="/money/budgets" variant="secondary">
                        Set budgets
                      </ButtonLink>
                    </div>
                  )}
                </section>
              </div>
            </Card>

            <Card
              span={5}
              title="Accounts and cards"
              footer={<MoreLink href="/money/accounts">Manage accounts</MoreLink>}
            >
              <Rows rows={accountRows} />
            </Card>

            <Card
              span={7}
              title="Latest transactions"
              footer={<MoreLink href="/money">See all transactions</MoreLink>}
            >
              {latest.length ? (
                <Rows rows={latest} />
              ) : (
                <div className={styles.empty}>
                  <p>No transactions yet.</p>
                  <AddTransactionButton />
                </div>
              )}
            </Card>
          </div>
        </div>
      </InvestmentDrawerProvider>
    </TransactionDrawerProvider>
  );
}
