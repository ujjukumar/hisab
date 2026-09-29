'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { budgets, categories } from '@/lib/db/schema';
import { budgetsForMonth } from '@/lib/domain/budgets';
import { addMonths } from '@/lib/domain/dates';
import { keepForUndo, takeUndo } from '@/lib/undo';
import {
  budgetSchema,
  failed,
  invalid,
  monthSchema,
  type ActionResult,
} from '@/lib/validation/money';

function revalidate() {
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

/**
 * Set a category's budget from `month` onward (it carries forward until the next change).
 * An empty amount or 0 means no budget from this month.
 */
export async function setBudget(input: {
  categoryId: number;
  month: string;
  amount: string;
}): Promise<ActionResult> {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { categoryId, month, amount } = parsed.data;

  const result = db.transaction((tx): ActionResult => {
    const category = tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get();
    if (!category) return failed('That category no longer exists.');
    if (category.kind !== 'expense') return failed('Budgets are for spending categories only.');

    const rows = tx
      .select({
        categoryId: budgets.categoryId,
        startMonth: budgets.startMonth,
        amount: budgets.amount,
      })
      .from(budgets)
      .where(eq(budgets.categoryId, categoryId))
      .all();
    // A change back to what last month carries in needs no row of its own.
    const carried = budgetsForMonth(rows, addMonths(month, -1)).get(categoryId) ?? 0;
    if (amount === carried) {
      tx.delete(budgets)
        .where(and(eq(budgets.categoryId, categoryId), eq(budgets.startMonth, month)))
        .run();
    } else {
      tx.insert(budgets)
        .values({ categoryId, startMonth: month, amount })
        .onConflictDoUpdate({
          target: [budgets.categoryId, budgets.startMonth],
          set: { amount, updatedAt: new Date().toISOString() },
        })
        .run();
    }
    return { ok: true, id: categoryId };
  });

  if (result.ok) revalidate();
  return result;
}

/**
 * Make `month` use last month's budgets again by removing the changes made in it.
 * Budgets carry forward, so this is all a copy needs. Undo puts the changes back.
 */
export async function copyLastMonthsBudgets(month: string): Promise<ActionResult> {
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) return failed('Pick a month.');

  const removed = db.transaction((tx) =>
    tx.delete(budgets).where(eq(budgets.startMonth, parsed.data)).returning().all(),
  );
  if (removed.length === 0) return failed("This month already uses last month's budgets.");

  const undo = keepForUndo(() =>
    db.transaction((tx) => {
      for (const row of removed) {
        tx.insert(budgets)
          .values(row)
          .onConflictDoUpdate({
            target: [budgets.categoryId, budgets.startMonth],
            set: { amount: row.amount, updatedAt: row.updatedAt },
          })
          .run();
      }
    }),
  );
  revalidate();
  return { ok: true, undo };
}

export async function undoCopyBudgets(token: string): Promise<ActionResult> {
  const restore = takeUndo(token);
  if (!restore) return failed('Too late to undo that.');
  try {
    restore();
  } catch {
    // Only possible if a category was deleted in the meantime.
    return failed('Could not undo: a category has since been deleted.');
  }
  revalidate();
  return { ok: true };
}
