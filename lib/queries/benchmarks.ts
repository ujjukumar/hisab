import 'server-only';

import { asc, inArray, min } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { benchmarkPrices, benchmarks, investmentTransactions } from '@/lib/db/schema';
import { today, type IsoDate } from '@/lib/domain/dates';
import { benchmarkNeedsHistory } from '@/lib/domain/priceFeeds';

export function benchmarkList() {
  return db.select().from(benchmarks).orderBy(asc(benchmarks.id)).all();
}

export function benchmarkHistory(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(benchmarkPrices)
    .where(inArray(benchmarkPrices.benchmarkId, ids)).all();
}

/** The date of the first investment transaction, where benchmark history has to start. */
export function firstInvestmentDate(): IsoDate | null {
  return (db.select({ first: min(investmentTransactions.date) }).from(investmentTransactions)
    .get()?.first as IsoDate | null | undefined) ?? null;
}

/** Benchmarks whose stored index levels don't reach back to the first investment or up to this week. */
export function benchmarksMissingHistory(ids: number[]): number[] {
  if (!ids.length) return [];
  const first = firstInvestmentDate();
  if (!first) return [];
  const rows = db.select({ id: benchmarkPrices.benchmarkId, date: benchmarkPrices.date, price: benchmarkPrices.price })
    .from(benchmarkPrices).where(inArray(benchmarkPrices.benchmarkId, ids)).all();
  const asOf = today();
  return ids.filter((id) => benchmarkNeedsHistory(
    rows.filter((row) => row.id === id && row.price !== null).map((row) => row.date as IsoDate), first, asOf));
}
