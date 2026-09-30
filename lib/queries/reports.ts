import 'server-only';
import { and, eq, gte, lte, min, ne, sql, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { categories, investmentTransactions, transactions } from '@/lib/db/schema';
import {
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  monthEndsBetween,
  monthOf,
  today,
  type IsoDate,
  type IsoMonth,
} from '@/lib/domain/dates';
import { netInvested } from '@/lib/domain/holdings';
import type { Paise } from '@/lib/domain/money';
import { financialYearStartMonth } from './settings';

export type Basis = 'fy' | 'cal';

/** One category's year: a total for each month, then the year's total. */
export type CategoryYear = {
  key: string;
  name: string;
  color: string | null;
  months: Paise[];
  total: Paise;
};

export type YearReport = {
  basis: Basis;
  year: number;
  /** Every year with data, newest first. Always includes this year. */
  years: { value: number; label: string }[];
  label: string;
  from: IsoDate;
  to: IsoDate;
  months: IsoMonth[];
  spending: CategoryYear[];
  income: CategoryYear[];
  netInvested: Paise;
};

const yearLabel = (year: number, basis: Basis, startMonth: number) =>
  basis === 'fy' ? `FY ${financialYearLabel(year, startMonth)}` : String(year);

/** Income and spending by category and month for one financial or calendar year, from `?year&basis`. */
export async function yearReport(
  params: Record<string, string | string[] | undefined>,
): Promise<YearReport> {
  const basis: Basis = params.basis === 'cal' ? 'cal' : 'fy';
  const startMonth = basis === 'fy' ? await financialYearStartMonth() : 1;

  const latest = financialYearOf(today(), startMonth);
  const firstDates = [
    db
      .select({ d: min(transactions.date) })
      .from(transactions)
      .get()?.d,
    db
      .select({ d: min(investmentTransactions.date) })
      .from(investmentTransactions)
      .get()?.d,
  ].filter((d): d is string => !!d);
  const earliest = firstDates.length
    ? Math.min(latest, ...firstDates.map((d) => financialYearOf(d, startMonth)))
    : latest;
  const years = Array.from({ length: latest - earliest + 1 }, (_, i) => latest - i);

  const asked = Number(params.year);
  const year = years.includes(asked) ? asked : latest;
  const { from, to } = financialYearRange(year, startMonth);
  const months = monthEndsBetween(monthOf(from), monthOf(to)).map(monthOf);

  const month = sql<string>`substr(${transactions.date}, 1, 7)`;
  const rows = db
    .select({
      type: transactions.type,
      id: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      month,
      total: sum(transactions.amount).mapWith(Number),
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        ne(transactions.type, 'transfer'),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .groupBy(transactions.type, transactions.categoryId, month)
    .all();

  const byCategory = (type: 'income' | 'expense'): CategoryYear[] => {
    const found = new Map<string, CategoryYear>();
    for (const r of rows) {
      if (r.type !== type) continue;
      const key = String(r.id ?? 'none');
      const row = found.get(key) ?? {
        key,
        name: r.name ?? 'Uncategorised',
        color: r.color,
        months: months.map(() => 0),
        total: 0,
      };
      row.months[months.indexOf(r.month)]! += r.total;
      row.total += r.total;
      found.set(key, row);
    }
    return [...found.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  };

  const invested = db
    .select({
      action: investmentTransactions.action,
      amount: investmentTransactions.amount,
      fees: investmentTransactions.fees,
    })
    .from(investmentTransactions)
    .where(and(gte(investmentTransactions.date, from), lte(investmentTransactions.date, to)))
    .all();

  return {
    basis,
    year,
    years: years.map((y) => ({ value: y, label: yearLabel(y, basis, startMonth) })),
    label: yearLabel(year, basis, startMonth),
    from,
    to,
    months,
    spending: byCategory('expense'),
    income: byCategory('income'),
    netInvested: netInvested(invested),
  };
}

/** Column totals of a category table: one per month, then the year. */
export function monthTotals(
  rows: CategoryYear[],
  months: number,
): { months: Paise[]; total: Paise } {
  const out = Array.from({ length: months }, (_, i) => rows.reduce((s, r) => s + r.months[i]!, 0));
  return { months: out, total: out.reduce((s, v) => s + v, 0) };
}
