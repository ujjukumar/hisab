'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { benchmarkPrices, benchmarks } from '@/lib/db/schema';
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
  if (result.ok) { revalidatePath('/settings'); revalidatePath('/investments', 'layout'); }
  return result;
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