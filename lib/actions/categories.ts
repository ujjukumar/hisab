'use server';

import { and, eq, max, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { budgets, categories, transactions } from '@/lib/db/schema';
import {
  categorySchema,
  failed,
  idSchema,
  invalid,
  type ActionResult,
} from '@/lib/validation/money';

function revalidate() {
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

/**
 * Add a category (id null) or rename / recolour an existing one.
 * The kind never changes after creation, so existing transactions stay valid.
 */
export async function saveCategory(id: number | null, formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const c = parsed.data;
  const existingId = id === null ? null : idSchema.safeParse(id);
  if (existingId && !existingId.success) return failed('That category no longer exists.');

  const result = db.transaction((tx): ActionResult => {
    const current = existingId
      ? tx.select().from(categories).where(eq(categories.id, existingId.data)).get()
      : undefined;
    if (existingId && !current) return failed('That category no longer exists.');
    const kind = current?.kind ?? c.kind;

    const sameName = and(eq(categories.name, c.name), eq(categories.kind, kind));
    const clash = tx
      .select({ id: categories.id })
      .from(categories)
      .where(current ? and(sameName, ne(categories.id, current.id)) : sameName)
      .get();
    if (clash)
      return failed(`There is already a category called “${c.name}”. Choose another name.`, 'name');

    if (current) {
      tx.update(categories)
        .set({ name: c.name, color: c.color, updatedAt: new Date().toISOString() })
        .where(eq(categories.id, current.id))
        .run();
      return { ok: true, id: current.id };
    }
    const last = tx
      .select({ n: max(categories.sortOrder) })
      .from(categories)
      .get();
    const row = tx
      .insert(categories)
      .values({ ...c, sortOrder: (last?.n ?? -1) + 1 })
      .returning({ id: categories.id })
      .get();
    return { ok: true, id: row.id };
  });

  if (result.ok) revalidate();
  return result;
}

export async function setCategoryArchived(id: number, archived: boolean): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success || typeof archived !== 'boolean')
    return failed('That category no longer exists.');
  const row = db.transaction((tx) =>
    tx
      .update(categories)
      .set({ archived: archived ? 1 : 0, updatedAt: new Date().toISOString() })
      .where(eq(categories.id, parsedId.data))
      .returning({ id: categories.id })
      .get(),
  );
  if (!row) return failed('That category no longer exists.');
  revalidate();
  return { ok: true, id: row.id };
}

/** Only a category with no transactions and no budgets can be deleted. */
export async function deleteCategory(id: number): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed('That category no longer exists.');
  const result = db.transaction((tx): ActionResult => {
    const used =
      tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.categoryId, parsedId.data))
        .get() ??
      tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(eq(budgets.categoryId, parsedId.data))
        .get();
    if (used)
      return failed('This category has transactions or budgets, so it can only be archived.');
    tx.delete(categories).where(eq(categories.id, parsedId.data)).run();
    return { ok: true, id: parsedId.data };
  });
  if (result.ok) revalidate();
  return result;
}
