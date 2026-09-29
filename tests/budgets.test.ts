import { describe, expect, it } from 'vitest';
import { budgetsForMonth } from '@/lib/domain/budgets';

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
});
