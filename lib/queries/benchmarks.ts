import 'server-only';

import { asc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { benchmarkPrices, benchmarks } from '@/lib/db/schema';

export function benchmarkList() {
  return db.select().from(benchmarks).orderBy(asc(benchmarks.id)).all();
}

export function benchmarkHistory(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(benchmarkPrices)
    .where(inArray(benchmarkPrices.benchmarkId, ids)).all();
}