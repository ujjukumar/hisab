import 'server-only';
import { and, asc, count, desc, eq, gte, lte, or, sql, sum, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db/client';
import {
  accounts,
  budgets,
  categories,
  investmentTransactions,
  transactions,
} from '@/lib/db/schema';
import { accountBalance, summarise, type Flow } from '@/lib/domain/balances';
import {
  currentMonth,
  endOfMonth,
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  isValidDate,
  monthOf,
  startOfMonth,
  today,
  type IsoDate,
  type IsoMonth,
} from '@/lib/domain/dates';
import type { Paise } from '@/lib/domain/money';
import { monthBudgets } from './budgets';
import { financialYearStartMonth } from './settings';

// ponytail: balances replay every transaction on each request. Fine for a
// household's few thousand rows a year; add a per-account running total if it ever drags.
function allFlows(): Flow[] {
  return db
    .select({
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
    })
    .from(transactions)
    .all();
}

/* ---------- accounts ---------- */

export type AccountRow = {
  id: number;
  name: string;
  type: (typeof accounts.$inferSelect)['type'];
  openingBalance: Paise;
  openingDate: IsoDate;
  note: string | null;
  archived: boolean;
  balance: Paise;
  lastDate: IsoDate | null;
  transactionCount: number;
};

export function listAccounts(): AccountRow[] {
  const flows = allFlows();
  const onDate = today();
  return db
    .select()
    .from(accounts)
    .orderBy(asc(accounts.sortOrder), asc(accounts.id))
    .all()
    .map((a) => {
      let lastDate: IsoDate | null = null;
      let transactionCount = 0;
      for (const f of flows) {
        if (f.accountId !== a.id && f.toAccountId !== a.id) continue;
        transactionCount += 1;
        if (!lastDate || f.date > lastDate) lastDate = f.date;
      }
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        note: a.note,
        archived: a.archived === 1,
        balance: accountBalance(a, flows, onDate),
        lastDate,
        transactionCount,
      };
    });
}

/* ---------- categories ---------- */

export type CategoryOption = {
  id: number;
  name: string;
  kind: 'income' | 'expense';
  color: string;
  archived: boolean;
};

export function listCategories(): CategoryOption[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      color: categories.color,
      archived: sql<boolean>`${categories.archived} = 1`.mapWith(Boolean),
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
}

export type CategoryRow = CategoryOption & { count: number; total: Paise; used: boolean };

/** Every category with its transactions this financial year, and whether anything refers to it at all. */
export async function listCategoriesWithTotals(): Promise<{
  rows: CategoryRow[];
  yearLabel: string;
}> {
  const startMonth = await financialYearStartMonth();
  const year = financialYearOf(today(), startMonth);
  const range = financialYearRange(year, startMonth);
  const totals = new Map(
    db
      .select({
        id: transactions.categoryId,
        n: count(),
        total: sum(transactions.amount).mapWith(Number),
      })
      .from(transactions)
      .where(and(gte(transactions.date, range.from), lte(transactions.date, range.to)))
      .groupBy(transactions.categoryId)
      .all()
      .map((r) => [r.id, r]),
  );
  const used = new Set(
    [
      ...db.selectDistinct({ id: transactions.categoryId }).from(transactions).all(),
      ...db.selectDistinct({ id: budgets.categoryId }).from(budgets).all(),
    ].map((r) => r.id),
  );
  const rows = listCategories().map((c) => ({
    ...c,
    count: totals.get(c.id)?.n ?? 0,
    total: totals.get(c.id)?.total ?? 0,
    used: used.has(c.id),
  }));
  return { rows, yearLabel: financialYearLabel(year, startMonth) };
}

/* ---------- transactions ---------- */

export const TYPE_FILTERS = ['income', 'expense', 'transfer'] as const;

export type TxnFilters = {
  from: IsoDate;
  to: IsoDate;
  type: (typeof TYPE_FILTERS)[number] | null;
  categoryId: number | null;
  accountId: number | null;
  q: string;
  sort: 'date' | 'amount';
  dir: 'asc' | 'desc';
  limit: number;
};

export const PAGE_SIZE = 100;

type Params = Record<string, string | string[] | undefined>;

/** Read the filter bar's state from the URL. Anything malformed falls back to its default. */
export function parseTxnFilters(params: Params): TxnFilters {
  const one = (key: string) => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  };
  const id = (key: string) => {
    const n = Number(one(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const month = currentMonth();
  const from = isValidDate(one('from')) ? one('from') : startOfMonth(month);
  const to = isValidDate(one('to')) ? one('to') : endOfMonth(month);
  const type = one('type');
  const limit = Number(one('limit'));
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    type: (TYPE_FILTERS as readonly string[]).includes(type) ? (type as TxnFilters['type']) : null,
    categoryId: id('cat'),
    accountId: id('acct'),
    q: one('q').slice(0, 100),
    sort: one('sort') === 'amount' ? 'amount' : 'date',
    dir: one('dir') === 'asc' ? 'asc' : 'desc',
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100_000) : PAGE_SIZE,
  };
}

/** The filters as URL params, leaving out anything at its default. */
export function txnFilterParams(f: TxnFilters): URLSearchParams {
  const month = currentMonth();
  const p = new URLSearchParams();
  if (f.from !== startOfMonth(month) || f.to !== endOfMonth(month)) {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  if (f.type) p.set('type', f.type);
  if (f.categoryId) p.set('cat', String(f.categoryId));
  if (f.accountId) p.set('acct', String(f.accountId));
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'date') p.set('sort', f.sort);
  if (f.dir !== 'desc') p.set('dir', f.dir);
  if (f.limit !== PAGE_SIZE) p.set('limit', String(f.limit));
  return p;
}

/** The month a range covers exactly, or null. Drives the "September 2026 (n)" title. */
export function wholeMonth(from: IsoDate, to: IsoDate): IsoMonth | null {
  const m = monthOf(from);
  return from === startOfMonth(m) && to === endOfMonth(m) ? m : null;
}

const toAccount = alias(accounts, 'to_account');

function whereFor(f: TxnFilters): SQL | undefined {
  const pattern = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return and(
    gte(transactions.date, f.from),
    lte(transactions.date, f.to),
    f.type ? eq(transactions.type, f.type) : undefined,
    f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.accountId
      ? or(eq(transactions.accountId, f.accountId), eq(transactions.toAccountId, f.accountId))
      : undefined,
    f.q
      ? or(
          sql`${transactions.description} LIKE ${pattern} ESCAPE '\\'`,
          sql`${transactions.note} LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined,
  );
}

export type TxnRow = {
  id: number;
  date: IsoDate;
  type: 'income' | 'expense' | 'transfer';
  amount: Paise;
  description: string;
  note: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  accountId: number | null;
  accountName: string | null;
  toAccountId: number | null;
  toAccountName: string | null;
  /** Set on rows created by an investment transaction. */
  assetId: number | null;
};

export function listTransactions(
  f: TxnFilters,
  options: { all?: boolean } = {},
): { rows: TxnRow[]; count: number; income: Paise; spending: Paise } {
  const where = whereFor(f);
  const totals = db
    .select({
      count: count(),
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} end), 0)`,
      spending: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .where(where)
    .get() ?? { count: 0, income: 0, spending: 0 };

  const order = f.dir === 'asc' ? asc : desc;
  const query = db
    .select({
      id: transactions.id,
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      note: transactions.note,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      accountId: transactions.accountId,
      accountName: accounts.name,
      toAccountId: transactions.toAccountId,
      toAccountName: toAccount.name,
      assetId: investmentTransactions.assetId,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(toAccount, eq(transactions.toAccountId, toAccount.id))
    .leftJoin(investmentTransactions, eq(transactions.investmentTxnId, investmentTransactions.id))
    .where(where)
    .orderBy(
      ...(f.sort === 'amount'
        ? [order(transactions.amount), desc(transactions.date)]
        : [order(transactions.date)]),
      order(transactions.id),
    );

  const rows = options.all ? query.all() : query.limit(f.limit).all();
  return { rows, ...totals };
}

/* ---------- the Money strip ---------- */

export type MoneyStrip = {
  month: IsoMonth;
  income: Paise;
  incomeCount: number;
  spending: Paise;
  budget: Paise;
  saved: Paise;
  savingsRate: number | null;
  bankAndCash: Paise;
  accountCount: number;
};

export function moneyStrip(month: IsoMonth = currentMonth()): MoneyStrip {
  const summary = summarise(
    db
      .select({ type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(
        and(gte(transactions.date, startOfMonth(month)), lte(transactions.date, endOfMonth(month))),
      )
      .all(),
  );
  const { budget } = monthBudgets(month);
  const active = listAccounts().filter((a) => !a.archived);
  return {
    month,
    ...summary,
    budget,
    bankAndCash: active.reduce((total, a) => total + a.balance, 0),
    accountCount: active.length,
  };
}
