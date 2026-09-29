import { describe, expect, it } from 'vitest';
import { budgetsForMonth, budgetTotals } from '@/lib/domain/budgets';

const rows = [
  { categoryId: 1, startMonth: '2026-01', amount: 1000 },
  { categoryId: 1, startMonth: '2026-06', amount: 1500 },
  { categoryId: 2, startMonth: '2026-01', amount: 800 },
  { categoryId: 2, startMonth: '2026-04', amount: 0 },
];

describe('budgetsForMonth', () => {
  it('carries a budget forward until it changes', () => {
    expect(budgetsForMonth(rows, '2026-03').get(1)).toBe(1000);
    expect(budgetsForMonth(rows, '2026-06').get(1)).toBe(1500);
    expect(budgetsForMonth(rows, '2027-02').get(1)).toBe(1500);
  });

  it('treats an amount of 0 as no budget from that month', () => {
    expect(budgetsForMonth(rows, '2026-03').get(2)).toBe(800);
    expect(budgetsForMonth(rows, '2026-04').has(2)).toBe(false);
  });

  it('has nothing for a category without a budget, or before the first one', () => {
    expect(budgetsForMonth(rows, '2026-05').has(3)).toBe(false);
    expect(budgetsForMonth(rows, '2025-12').size).toBe(0);
  });

  it('lets a budget come back after a 0', () => {
    const again = [...rows, { categoryId: 2, startMonth: '2026-08', amount: 900 }];
    expect(budgetsForMonth(again, '2026-07').has(2)).toBe(false);
    expect(budgetsForMonth(again, '2026-08').get(2)).toBe(900);
  });

  it('ignores a later row for an earlier month', () => {
    expect(
      budgetsForMonth([{ categoryId: 1, startMonth: '2026-06', amount: 1 }], '2026-05').size,
    ).toBe(0);
  });
});

describe('budgetTotals', () => {
  const budgets = new Map([
    [1, 10_000],
    [2, 5_000],
    [3, 2_000],
  ]);

  it('works out spent and left per category, over only when spent passes the budget', () => {
    const t = budgetTotals(
      budgets,
      new Map([
        [1, 12_500],
        [2, 5_000],
      ]),
    );
    expect(t.lines).toEqual([
      { categoryId: 1, budget: 10_000, spent: 12_500, left: -2_500, over: true },
      { categoryId: 2, budget: 5_000, spent: 5_000, left: 0, over: false },
      { categoryId: 3, budget: 2_000, spent: 0, left: 2_000, over: false },
    ]);
  });

  it('totals only budgeted categories and reports the rest separately', () => {
    const t = budgetTotals(
      budgets,
      new Map([
        [1, 3_000],
        [4, 7_000],
      ]),
    );
    expect(t).toMatchObject({ budget: 17_000, spent: 3_000, left: 14_000, over: false });
    expect(t.unbudgetedSpent).toBe(7_000);
  });

  it('is over in total when budgeted spending passes the total budget', () => {
    const t = budgetTotals(new Map([[1, 1_000]]), new Map([[1, 1_001]]));
    expect(t).toMatchObject({ left: -1, over: true });
  });

  it('is all zeros with no budgets', () => {
    expect(budgetTotals(new Map(), new Map([[4, 500]]))).toEqual({
      lines: [],
      budget: 0,
      spent: 0,
      left: 0,
      over: false,
      unbudgetedSpent: 500,
    });
  });
});
