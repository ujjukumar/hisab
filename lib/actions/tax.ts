'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { taxYears } from '@/lib/db/schema';
import { invalid, type ActionResult } from '@/lib/validation/money';
import { taxYearSchema } from '@/lib/validation/tax';

/** Save the owner's salary, TDS and other figures for one financial year. */
export async function saveTaxYear(formData: FormData): Promise<ActionResult> {
  const parsed = taxYearSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { year, ...values } = parsed.data;

  db.transaction((tx) => {
    tx.insert(taxYears)
      .values({ year, ...values })
      .onConflictDoUpdate({
        target: taxYears.year,
        set: { ...values, updatedAt: new Date().toISOString() },
      })
      .run();
  });
  revalidatePath('/tax', 'layout');
  return { ok: true };
}
