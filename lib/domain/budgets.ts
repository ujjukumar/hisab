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
