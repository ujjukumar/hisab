import 'server-only';
import { and, asc, eq, gte, lte, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { budgets, categories, transactions } from '@/lib/db/schema';
import { budgetsForMonth, budgetTotals, type BudgetLine } from '@/lib/domain/budgets';
import { addMonths, endOfMonth, startOfMonth, type IsoMonth } from '@/lib/domain/dates';
import type { Paise } from '@/lib/domain/money';

export type BudgetCategory = {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  spent: Paise;
};

export type MonthBudgets = {
  month: IsoMonth;
  /** Categories with a budget this month, in category order. */
  rows: (BudgetCategory & BudgetLine)[];
  /** Active spending categories without one. */
  without: BudgetCategory[];
  budget: Paise;
  spent: Paise;
  left: Paise;
  over: boolean;
  unbudgetedSpent: Paise;
  /** This month has budgets set in it, rather than only carried forward. */
  changedThisMonth: boolean;
  lastMonthHasBudgets: boolean;
};

/**
 * Every budget figure for a month. The Budgets tab, the Money strip and the
 * Dashboard's budget card all read this, so they always agree.
 */
export function monthBudgets(month: IsoMonth): MonthBudgets {
  const cats = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      archived: categories.archived,
    })
    .from(categories)
    .where(eq(categories.kind, 'expense'))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
  const spending = new Set(cats.map((c) => c.id));

  const spent = new Map<number, Paise>();
  for (const r of db
    .select({ id: transactions.categoryId, total: sum(transactions.amount).mapWith(Number) })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'expense'),
        gte(transactions.date, startOfMonth(month)),
        lte(transactions.date, endOfMonth(month)),
      ),
    )
    .groupBy(transactions.categoryId)
    .all()) {
    if (r.id !== null) spent.set(r.id, r.total ?? 0);
  }

  const all = db
    .select({
      categoryId: budgets.categoryId,
      startMonth: budgets.startMonth,
      amount: budgets.amount,
    })
    .from(budgets)
    .all()
    .filter((b) => spending.has(b.categoryId));
  const { lines, ...totals } = budgetTotals(budgetsForMonth(all, month), spent);
  const lineById = new Map(lines.map((l) => [l.categoryId, l]));

  const rows: MonthBudgets['rows'] = [];
  const without: BudgetCategory[] = [];
  for (const c of cats) {
    const category = { ...c, archived: c.archived === 1, spent: spent.get(c.id) ?? 0 };
    const line = lineById.get(c.id);
    if (line) rows.push({ ...category, ...line });
    else if (!category.archived) without.push(category);
  }

  return {
    month,
    rows,
    without,
    ...totals,
    changedThisMonth: all.some((b) => b.startMonth === month),
    lastMonthHasBudgets: budgetsForMonth(all, addMonths(month, -1)).size > 0,
  };
}
