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
