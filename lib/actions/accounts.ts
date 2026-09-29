'use server';

import { and, eq, max, ne, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { accounts, transactions } from '@/lib/db/schema';
import {
  accountSchema,
  failed,
  idSchema,
  invalid,
  type ActionResult,
} from '@/lib/validation/money';

function revalidate() {
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

/** Add an account (id null) or change an existing one. */
export async function saveAccount(id: number | null, formData: FormData): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const a = parsed.data;
  const existingId = id === null ? null : idSchema.safeParse(id);
  if (existingId && !existingId.success) return failed('That account no longer exists.');

  const result = db.transaction((tx): ActionResult => {
    const clash = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        existingId
          ? and(eq(accounts.name, a.name), ne(accounts.id, existingId.data))
          : eq(accounts.name, a.name),
      )
      .get();
    if (clash)
      return failed(`You already have an account called “${a.name}”. Choose another name.`, 'name');

    if (!existingId) {
      const last = tx
        .select({ n: max(accounts.sortOrder) })
        .from(accounts)
        .get();
      const row = tx
        .insert(accounts)
        .values({ ...a, sortOrder: (last?.n ?? -1) + 1 })
        .returning({ id: accounts.id })
        .get();
      return { ok: true, id: row.id };
    }
    const updated = tx
      .update(accounts)
      .set({ ...a, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, existingId.data))
      .returning({ id: accounts.id })
      .get();
    return updated ? { ok: true, id: updated.id } : failed('That account no longer exists.');
  });

  if (result.ok) revalidate();
  return result;
}

export async function setAccountArchived(id: number, archived: boolean): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success || typeof archived !== 'boolean')
    return failed('That account no longer exists.');
  const row = db.transaction((tx) =>
    tx
      .update(accounts)
      .set({ archived: archived ? 1 : 0, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, parsedId.data))
      .returning({ id: accounts.id })
      .get(),
  );
  if (!row) return failed('That account no longer exists.');
  revalidate();
  return { ok: true, id: row.id };
}

/** Only an account nothing points at can be deleted. Anything else is archived instead. */
export async function deleteAccount(id: number): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed('That account no longer exists.');
  const result = db.transaction((tx): ActionResult => {
    const used = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        or(eq(transactions.accountId, parsedId.data), eq(transactions.toAccountId, parsedId.data)),
      )
      .get();
    if (used) return failed('This account has transactions, so it can only be archived.');
    tx.delete(accounts).where(eq(accounts.id, parsedId.data)).run();
    return { ok: true, id: parsedId.data };
  });
  if (result.ok) revalidate();
  return result;
}
