import { BudgetsTable } from '@/components/BudgetsTable/BudgetsTable';
import { MonthPicker } from '@/components/MonthPicker/MonthPicker';
import { currentMonth, isValidMonth, monthLabel } from '@/lib/domain/dates';
import { formatINR } from '@/lib/domain/format';
import { monthBudgets } from '@/lib/queries/budgets';

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const param = (await searchParams).month;
  const current = currentMonth();
  const month = typeof param === 'string' && isValidMonth(param) ? param : current;
  const data = monthBudgets(month);

  return (
    <div className="wrap page-body stack">
      <MonthPicker
        month={month}
        current={current}
        href={(m) => (m === current ? '/money/budgets' : `/money/budgets?month=${m}`)}
      />
      <BudgetsTable data={data} />
      <p className="footnote" style={{ margin: 0 }}>
        All amounts in ₹. Budgets carry forward until you change them, so a change here applies from{' '}
        {monthLabel(month)} onward. Clearing a budget removes it from {monthLabel(month)} onward.
        {data.unbudgetedSpent > 0 &&
          ` Spending in categories without a budget (${formatINR(data.unbudgetedSpent)}) isn't in the totals.`}
      </p>
    </div>
  );
}
