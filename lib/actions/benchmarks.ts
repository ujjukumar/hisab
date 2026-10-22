'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyBenchmarkPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import { benchmarkPrices, benchmarks } from '@/lib/db/schema';
import { FeedError, benchmarkNavHistory } from '@/lib/feeds';
import { benchmarksMissingHistory } from '@/lib/queries/benchmarks';
import { failed, invalid, type ActionResult } from '@/lib/validation/money';

const addSchema = z.object({
  name: z.string().trim().min(1, 'Enter a benchmark name.').max(40, 'Use 40 characters or fewer.'),
  isin: z.string().trim().toUpperCase().regex(/^INF[A-Z0-9]{9}$/, 'Enter a fund ISIN starting with INF.'),
});

export async function addBenchmark(formData: FormData): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = db.transaction((tx) => {
    const existing = tx.select().from(benchmarks).all();
    if (existing.length >= 8) return failed('You can compare up to 8 benchmarks. Remove one first.');
    if (existing.some((row) => row.isin === parsed.data.isin))
      return failed('That ISIN is already a benchmark.', 'isin');
    tx.insert(benchmarks).values(parsed.data).run();
    return { ok: true } as const;
  });
  if (result.ok) {
    await fillHistory([...ids(parsed.data.isin)]).catch(() => undefined);
    revalidatePath('/settings');
    revalidatePath('/investments', 'layout');
  }
  return result;
}

const ids = (isin: string) => db.select({ id: benchmarks.id }).from(benchmarks)
  .where(eq(benchmarks.isin, isin)).all().map((row) => row.id);

async function fillHistory(benchmarkIds: number[]): Promise<string[]> {
  const missing = benchmarksMissingHistory(benchmarkIds);
  const list = missing.length
    ? db.select().from(benchmarks).where(inArray(benchmarks.id, missing)).all() : [];
  const errors: string[] = [];
  for (const item of list) {
    try {
      const history = await benchmarkNavHistory(item.isin);
      applyBenchmarkPrices(db, history.map((row) => ({ benchmarkId: item.id, ...row })));
    } catch (error) {
      if (!(error instanceof FeedError)) throw error;
      errors.push(`${item.name}: ${error.message}`);
    }
  }
  return errors;
}

const fillSchema = z.array(z.number().int().positive()).max(8);

/** Fetches the NAV history of benchmarks being compared, when it isn't stored yet. */
export async function fillBenchmarkHistory(benchmarkIds: number[]): Promise<ActionResult> {
  const parsed = fillSchema.safeParse(benchmarkIds);
  if (!parsed.success) return invalid(parsed.error);
  const errors = await fillHistory(parsed.data);
  revalidatePath('/investments', 'layout');
  return errors.length ? failed(errors.join(' ')) : { ok: true };
}

const removeSchema = z.coerce.number().int().positive();

export async function removeBenchmark(formData: FormData): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(formData.get('id'));
  if (!parsed.success) return invalid(parsed.error);
  db.transaction((tx) => {
    tx.delete(benchmarkPrices).where(eq(benchmarkPrices.benchmarkId, parsed.data)).run();
    tx.delete(benchmarks).where(eq(benchmarks.id, parsed.data)).run();
  });
  revalidatePath('/settings');
  revalidatePath('/investments', 'layout');
  return { ok: true };
}