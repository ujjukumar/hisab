'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyBenchmarkPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import { benchmarkPrices, benchmarks } from '@/lib/db/schema';
import { addDays } from '@/lib/domain/dates';
import { MAX_BENCHMARKS, benchmarkIndex } from '@/lib/domain/benchmarks';
import { FeedError, indexHistory } from '@/lib/feeds';
import { benchmarksMissingHistory, firstInvestmentDate } from '@/lib/queries/benchmarks';
import { failed, invalid, type ActionResult } from '@/lib/validation/money';

const addSchema = z.object({
  code: z.string().trim().refine((code) => benchmarkIndex(code) !== undefined, 'Choose an index from the list.'),
});

export async function addBenchmark(formData: FormData): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const index = benchmarkIndex(parsed.data.code)!;
  const result = db.transaction((tx) => {
    const existing = tx.select().from(benchmarks).all();
    if (existing.some((row) => row.code === index.code)) return failed(`${index.name} is already a benchmark.`, 'code');
    if (existing.length >= MAX_BENCHMARKS)
      return failed(`You can compare up to ${MAX_BENCHMARKS} indices. Remove one first.`);
    const row = tx.insert(benchmarks).values({ code: index.code, name: index.name }).returning({ id: benchmarks.id }).get();
    return { ok: true, id: row.id } as const;
  });
  if (!result.ok) return result;
  await fillHistory([result.id]).catch(() => undefined);
  revalidatePath('/settings');
  revalidatePath('/investments', 'layout');
  return { ok: true };
}

async function fillHistory(benchmarkIds: number[]): Promise<string[]> {
  const missing = benchmarksMissingHistory(benchmarkIds);
  const first = firstInvestmentDate();
  const list = missing.length && first
    ? db.select().from(benchmarks).where(inArray(benchmarks.id, missing)).all() : [];
  const errors: string[] = [];
  for (const item of list) {
    const index = benchmarkIndex(item.code);
    if (!index) continue;
    try {
      // A couple of weeks earlier, so the first investment has a close to start from.
      const history = await indexHistory(index.symbol, addDays(first!, -14));
      applyBenchmarkPrices(db, history.map((row) => ({ benchmarkId: item.id, ...row })));
    } catch (error) {
      if (!(error instanceof FeedError)) throw error;
      errors.push(`${item.name}: ${error.message}`);
    }
  }
  return errors;
}

const fillSchema = z.array(z.number().int().positive()).max(MAX_BENCHMARKS);

/** Fetches the index history of benchmarks being compared, when it isn't stored or is stale. */
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
