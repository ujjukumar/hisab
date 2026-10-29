'use server';

import { and, eq, inArray, max, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { budgets, categories, smsMessages, smsRules, transactions } from '@/lib/db/schema';
import { mergeBudgetRows } from '@/lib/domain/budgets';
import type { IsoMonth } from '@/lib/domain/dates';
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

/**
 * Fold one category into another of the same kind: its transactions, budgets, SMS rules
 * and waiting SMS move across, then it is deleted. Budgets that overlap are added up.
 */
export async function mergeCategory(fromId: number, intoId: number): Promise<ActionResult> {
  const from = idSchema.safeParse(fromId);
  const into = idSchema.safeParse(intoId);
  if (!from.success) return failed('That category no longer exists.');
  if (!into.success) return failed('Pick the category to merge into.', 'into');
  if (from.data === into.data) return failed('Pick a different category to merge into.', 'into');

  const result = db.transaction((tx): ActionResult => {
    const source = tx.select().from(categories).where(eq(categories.id, from.data)).get();
    const target = tx.select().from(categories).where(eq(categories.id, into.data)).get();
    if (!source) return failed('That category no longer exists.');
    if (!target) return failed('That category no longer exists.', 'into');
    if (source.kind !== target.kind)
      return failed('A category can only merge into one of the same kind.', 'into');

    const stamp = new Date().toISOString();
    tx.update(transactions)
      .set({ categoryId: target.id, updatedAt: stamp })
      .where(eq(transactions.categoryId, source.id))
      .run();
    tx.update(smsRules)
      .set({ incomeCategoryId: target.id, updatedAt: stamp })
      .where(eq(smsRules.incomeCategoryId, source.id))
      .run();
    tx.update(smsRules)
      .set({ expenseCategoryId: target.id, updatedAt: stamp })
      .where(eq(smsRules.expenseCategoryId, source.id))
      .run();
    tx.update(smsMessages)
      .set({ proposedCategoryId: target.id, updatedAt: stamp })
      .where(eq(smsMessages.proposedCategoryId, source.id))
      .run();

    const history = (id: number) =>
      tx
        .select({ startMonth: budgets.startMonth, amount: budgets.amount })
        .from(budgets)
        .where(eq(budgets.categoryId, id))
        .all() as { startMonth: IsoMonth; amount: number }[];
    const merged = mergeBudgetRows(history(source.id), history(target.id));
    tx.delete(budgets).where(inArray(budgets.categoryId, [source.id, target.id])).run();
    for (const row of merged) tx.insert(budgets).values({ categoryId: target.id, ...row }).run();

    tx.delete(categories).where(eq(categories.id, source.id)).run();
    return { ok: true, id: target.id };
  });

  if (result.ok) revalidate();
  return result;
}
