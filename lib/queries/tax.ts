import 'server-only';
import { and, eq, gte, inArray, isNull, lte, min, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  assets,
  categories,
  investmentTransactions,
  taxYears,
  transactions,
} from '@/lib/db/schema';
import {
  realisedLots,
  summariseGains,
  type GainSummary,
  type SaleLot,
} from '@/lib/domain/capitalGains';
import {
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  today,
  type IsoDate,
} from '@/lib/domain/dates';
import { formatDate } from '@/lib/domain/format';
import { OversellError, type HoldingTxn } from '@/lib/domain/holdings';
import type { Paise } from '@/lib/domain/money';
import { computeTax, fdWithdrawalInterest, type TaxComputation } from '@/lib/domain/tax';
import { taxRulesFor, type TaxRules } from '@/lib/domain/taxRules';
import { paramReader, type Params } from './money';

/** The tax year always runs April to March, whatever the Reports setting says. */
const START_MONTH = 4;

export type TaxFigures = {
  grossSalary: Paise;
  salaryTds: Paise;
  otherTds: Paise;
  taxPaid: Paise;
  otherIncome: Paise;
  interestOverride: Paise | null;
  dividendOverride: Paise | null;
};

export type GainRow = SaleLot & { key: string; assetName: string };

/** An income figure worked out from records, and the one the estimate uses. */
export type Worked = { worked: Paise; used: Paise; categoryId: number | null };

export type TaxReport = {
  year: number;
  label: string;
  from: IsoDate;
  to: IsoDate;
  /** Every year with data, newest first. Always includes this year. */
  years: { value: number; label: string }[];
  rules: TaxRules | null;
  /** Null until the owner saves figures for the year. */
  figures: TaxFigures | null;
  interest: Worked;
  dividends: Worked;
  intraday: Paise;
  gains: GainRow[];
  summary: GainSummary;
  computation: TaxComputation | null;
  /** Sales that couldn't be matched to purchases, one message per investment. */
  problems: string[];
};

const yearLabel = (year: number) => `FY ${financialYearLabel(year, START_MONTH)}`;

function incomeCategory(name: string): number | null {
  return (
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), eq(categories.kind, 'income')))
      .get()?.id ?? null
  );
}

/** Money income in a category that isn't already counted through an investment row. */
function unlinkedIncome(categoryId: number | null, from: IsoDate, to: IsoDate): Paise {
  if (categoryId === null) return 0;
  const row = db
    .select({ total: sum(transactions.amount).mapWith(Number) })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'income'),
        eq(transactions.categoryId, categoryId),
        isNull(transactions.investmentTxnId),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .get();
  return row?.total ?? 0;
}

/** The year's tax estimate from `?year`, with its matched sales. */
export function taxReport(params: Params): TaxReport {
  const { one } = paramReader(params);
  const latest = financialYearOf(today(), START_MONTH);
  const firstDates = [
    db.select({ d: min(transactions.date) }).from(transactions).get()?.d,
    db.select({ d: min(investmentTransactions.date) }).from(investmentTransactions).get()?.d,
    db.select({ d: min(taxYears.year) }).from(taxYears).get()?.d,
  ];
  const earliest = Math.min(
    latest,
    ...firstDates
      .filter((d): d is string | number => d != null)
      .map((d) => (typeof d === 'number' ? d : financialYearOf(d, START_MONTH))),
  );
  const years = Array.from({ length: latest - earliest + 1 }, (_, i) => latest - i);
  const asked = Number(one('year'));
  const year = years.includes(asked) ? asked : latest;
  const { from, to } = financialYearRange(year, START_MONTH);
  const inYear = (d: IsoDate) => d >= from && d <= to;

  const saved = db.select().from(taxYears).where(eq(taxYears.year, year)).get();
  const figures: TaxFigures | null = saved
    ? {
        grossSalary: saved.grossSalary,
        salaryTds: saved.salaryTds,
        otherTds: saved.otherTds,
        taxPaid: saved.taxPaid,
        otherIncome: saved.otherIncome,
        interestOverride: saved.interestOverride,
        dividendOverride: saved.dividendOverride,
      }
    : null;

  const allAssets = db
    .select({ id: assets.id, name: assets.name, type: assets.type, assetClass: assets.assetClass, valuation: assets.valuation })
    .from(assets)
    .all();
  const txns = db
    .select({
      id: investmentTransactions.id,
      assetId: investmentTransactions.assetId,
      date: investmentTransactions.date,
      action: investmentTransactions.action,
      units: investmentTransactions.units,
      price: investmentTransactions.price,
      amount: investmentTransactions.amount,
      fees: investmentTransactions.fees,
      splitFrom: investmentTransactions.splitFrom,
      splitTo: investmentTransactions.splitTo,
    })
    .from(investmentTransactions)
    .where(
      inArray(investmentTransactions.action, [
        'buy',
        'sell',
        'split',
        'intraday',
        'deposit',
        'withdrawal',
        'fee',
        'interest',
        'dividend',
      ]),
    )
    .all();
  const byAsset = new Map<number, HoldingTxn[]>();
  for (const t of txns) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);

  const gains: GainRow[] = [];
  const problems: string[] = [];
  let intraday = 0;
  let investmentInterest = 0;
  let investmentDividends = 0;
  for (const asset of allAssets) {
    const list = byAsset.get(asset.id) ?? [];
    for (const t of list) {
      if (!inYear(t.date)) continue;
      // PPF and EPF interest is exempt.
      if (t.action === 'interest' && asset.type !== 'ppf' && asset.type !== 'epf') {
        investmentInterest += t.amount ?? 0;
      }
      if (t.action === 'dividend') investmentDividends += t.amount ?? 0;
    }
    if (asset.valuation === 'fd') investmentInterest += fdWithdrawalInterest(list, from, to);
    if (asset.valuation !== 'units') continue;
    try {
      const result = realisedLots(asset, list);
      for (const [i, lot] of result.lots.entries()) {
        if (inYear(lot.sold)) gains.push({ ...lot, key: `${lot.saleTxnId}-${i}`, assetName: asset.name });
      }
      for (const r of result.intraday) if (inYear(r.date)) intraday += r.amount;
    } catch (error) {
      if (!(error instanceof OversellError)) throw error;
      const sale = list.find((t) => t.id === error.txnId);
      problems.push(
        `${asset.name}: the sale on ${formatDate(sale?.date ?? '')} sells more units than were bought. Fix it in Investments.`,
      );
    }
  }
  gains.sort((a, b) => (a.sold < b.sold ? -1 : a.sold > b.sold ? 1 : a.assetName.localeCompare(b.assetName)));

  const interestCategory = incomeCategory('Interest');
  const dividendCategory = incomeCategory('Dividends');
  const workedInterest = investmentInterest + unlinkedIncome(interestCategory, from, to);
  const workedDividends = investmentDividends + unlinkedIncome(dividendCategory, from, to);
  const interest: Worked = {
    worked: workedInterest,
    used: figures?.interestOverride ?? workedInterest,
    categoryId: interestCategory,
  };
  const dividends: Worked = {
    worked: workedDividends,
    used: figures?.dividendOverride ?? workedDividends,
    categoryId: dividendCategory,
  };

  const summary = summariseGains(gains);
  const rules = taxRulesFor(year);
  const computation = rules
    ? computeTax(rules, {
        salary: figures?.grossSalary ?? 0,
        interest: interest.used,
        dividends: dividends.used,
        otherIncome: figures?.otherIncome ?? 0,
        intraday,
        gains: summary,
        salaryTds: figures?.salaryTds ?? 0,
        otherTds: figures?.otherTds ?? 0,
        taxPaid: figures?.taxPaid ?? 0,
      })
    : null;

  return {
    year,
    label: yearLabel(year),
    from,
    to,
    years: years.map((y) => ({ value: y, label: yearLabel(y) })),
    rules,
    figures,
    interest,
    dividends,
    intraday,
    gains,
    summary,
    computation,
    problems,
  };
}
