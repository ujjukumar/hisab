'use server';

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import {
  accounts,
  categories,
  investmentTransactions,
  transactions,
  type InvestmentTransaction,
  type Transaction,
} from '@/lib/db/schema';
import {
  failed,
  idSchema,
  invalid,
  transactionSchema,
  type ActionResult,
  type TransactionInput,
} from '@/lib/validation/money';

const LINKED = 'This transaction was created by an investment transaction. Change it there.';

function revalidate() {
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

/** Checks Zod can't make: the category and accounts exist and fit the type. */
function checkReferences(t: TransactionInput): ActionResult | null {
  if (t.categoryId) {
    const category = db.select().from(categories).where(eq(categories.id, t.categoryId)).get();
    if (!category) return failed('That category no longer exists. Choose another.', 'categoryId');
    if (category.kind !== t.type) {
      return failed(
        t.type === 'income' ? 'Choose an income category.' : 'Choose a spending category.',
        'categoryId',
      );
    }
  }
  for (const field of ['accountId', 'toAccountId'] as const) {
    const id = t[field];
    if (id && !db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get()) {
      return failed('That account no longer exists. Choose another.', field);
    }
  }
  return null;
}

/** Add a transaction (id null) or change an existing one. */
export async function saveTransaction(
  id: number | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const t = parsed.data;
  const existingId = id === null ? null : idSchema.safeParse(id);
  if (existingId && !existingId.success) return failed('That transaction no longer exists.');

  const result = db.transaction((tx): ActionResult => {
    const problem = checkReferences(t);
    if (problem) return problem;
    if (!existingId) {
      const row = tx.insert(transactions).values(t).returning({ id: transactions.id }).get();
      return { ok: true, id: row.id };
    }
    const current = tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, existingId.data))
      .get();
    if (!current) return failed('That transaction no longer exists.');
    if (current.investmentTxnId) return failed(LINKED);
    tx.update(transactions)
      .set({ ...t, updatedAt: new Date().toISOString() })
      .where(eq(transactions.id, current.id))
      .run();
    return { ok: true, id: current.id };
  });

  if (result.ok) revalidate();
  return result;
}

/* ---------- delete with undo ---------- */

type Deleted = { expires: number; txn: Transaction; investment: InvestmentTransaction | null };

// ponytail: in-memory, so Undo is lost if the server restarts in the few seconds the toast is up.
const store = globalThis as unknown as { hisaabUndo?: Map<string, Deleted> };
const deleted = (store.hisaabUndo ??= new Map());

/** Delete right away and hand back a token for Undo. A linked row takes its investment transaction with it. */
export async function deleteTransaction(id: number): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed('That transaction no longer exists.');

  const now = Date.now();
  for (const [token, entry] of deleted) if (entry.expires < now) deleted.delete(token);

  const result = db.transaction((tx): ActionResult => {
    const txn = tx.select().from(transactions).where(eq(transactions.id, parsedId.data)).get();
    if (!txn) return failed('That transaction was already deleted.');
    let investment: InvestmentTransaction | null = null;
    if (txn.investmentTxnId) {
      investment =
        tx
          .select()
          .from(investmentTransactions)
          .where(eq(investmentTransactions.id, txn.investmentTxnId))
          .get() ?? null;
      // Deleting the investment side cascades to this row.
      tx.delete(investmentTransactions)
        .where(eq(investmentTransactions.id, txn.investmentTxnId))
        .run();
    }
    tx.delete(transactions).where(eq(transactions.id, txn.id)).run();
    const token = randomUUID();
    deleted.set(token, { expires: now + 60_000, txn, investment });
    return { ok: true, id: txn.id, undo: token };
  });

  if (result.ok) revalidate();
  return result;
}

/** Put a just-deleted transaction back exactly as it was, same id included. */
export async function undoDelete(token: string): Promise<ActionResult> {
  const entry = typeof token === 'string' ? deleted.get(token) : undefined;
  if (!entry || entry.expires < Date.now()) return failed('Too late to undo that delete.');
  deleted.delete(token);

  try {
    db.transaction((tx) => {
      if (entry.investment) tx.insert(investmentTransactions).values(entry.investment).run();
      tx.insert(transactions).values(entry.txn).run();
    });
  } catch {
    // Only possible if its account or category was deleted in the meantime.
    return failed('Could not undo: its account or category has since been deleted.');
  }

  revalidate();
  return { ok: true, id: entry.txn.id };
}
