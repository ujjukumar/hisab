import type { IsoMonth } from './dates';
import type { Paise } from './money';

export type BudgetRow = { categoryId: number; startMonth: IsoMonth; amount: Paise };

/**
 * The budget for each category in `month`: the row with the latest start month
 * on or before it. Categories whose latest row is 0 (or that have none) are left out.
 */
export function budgetsForMonth(rows: BudgetRow[], month: IsoMonth): Map<number, Paise> {
  const latest = new Map<number, BudgetRow>();
  for (const row of rows) {
    if (row.startMonth > month) continue;
    const seen = latest.get(row.categoryId);
    if (!seen || row.startMonth > seen.startMonth) latest.set(row.categoryId, row);
  }
  const out = new Map<number, Paise>();
  for (const [id, row] of latest) if (row.amount > 0) out.set(id, row.amount);
  return out;
}

/**
 * One budget history for two categories being merged: from each start month either of
 * them changed, the new budget is the sum of what both carried then. Months that would
 * only repeat the amount already carried are left out.
 */
export function mergeBudgetRows(
  a: Omit<BudgetRow, 'categoryId'>[],
  b: Omit<BudgetRow, 'categoryId'>[],
): { startMonth: IsoMonth; amount: Paise }[] {
  const carried = (rows: Omit<BudgetRow, 'categoryId'>[], month: IsoMonth) =>
    budgetsForMonth(
      rows.map((r) => ({ ...r, categoryId: 0 })),
      month,
    ).get(0) ?? 0;
  const months = [...new Set([...a, ...b].map((r) => r.startMonth))].sort();
  const out: { startMonth: IsoMonth; amount: Paise }[] = [];
  let previous = 0;
  for (const month of months) {
    const amount = carried(a, month) + carried(b, month);
    if (amount === previous) continue;
    out.push({ startMonth: month, amount });
    previous = amount;
  }
  return out;
}

export type BudgetLine = {
  categoryId: number;
  budget: Paise;
  spent: Paise;
  left: Paise;
  over: boolean;
};

export type BudgetTotals = {
  lines: BudgetLine[];
  /** Totals over categories that have a budget; other spending is not counted. */
  budget: Paise;
  spent: Paise;
  left: Paise;
  over: boolean;
  /** Spending in categories without a budget, so a page can say it was left out. */
  unbudgetedSpent: Paise;
};

/** Spent and left per budgeted category for one month, and the totals the budget card shows. */
export function budgetTotals(budgets: Map<number, Paise>, spent: Map<number, Paise>): BudgetTotals {
  const lines = [...budgets].map(([categoryId, budget]) => {
    const s = spent.get(categoryId) ?? 0;
    return { categoryId, budget, spent: s, left: budget - s, over: s > budget };
  });
  const sum = (key: 'budget' | 'spent') => lines.reduce((total, l) => total + l[key], 0);
  let unbudgetedSpent = 0;
  for (const [id, s] of spent) if (!budgets.has(id)) unbudgetedSpent += s;
  const budget = sum('budget');
  const spentTotal = sum('spent');
  return {
    lines,
    budget,
    spent: spentTotal,
    left: budget - spentTotal,
    over: spentTotal > budget,
    unbudgetedSpent,
  };
}
