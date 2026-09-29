'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  accounts,
  assets,
  categories,
  investmentTransactions,
  prices,
  transactions,
  valuations,
} from '@/lib/db/schema';
import { ACTION_LABELS, actionsFor } from '@/lib/domain/assets';
import { isValidDate, today } from '@/lib/domain/dates';
import { computeHolding, isSold, moneyMoved } from '@/lib/domain/holdings';
import { parsePaise } from '@/lib/domain/money';
import { unitsProblem } from '@/lib/queries/investments';
import { keepForUndo, takeUndo } from '@/lib/undo';
import {
  assetSchema,
  investmentTxnSchema,
  parseDecimal,
  type InvestmentTxnInput,
} from '@/lib/validation/investments';
import { failed, idSchema, invalid, type ActionResult } from '@/lib/validation/money';

function revalidate() {
  revalidatePath('/investments', 'layout');
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

const now = () => new Date().toISOString();

const GONE = 'That investment no longer exists.';

/* ---------- investment transactions ---------- */

type Linked = Pick<
  typeof transactions.$inferInsert,
  'type' | 'amount' | 'accountId' | 'toAccountId' | 'categoryId'
>;

/** The linked Money row (PLAN section 5): paid from, received in, or income for dividends and interest. */
function linkedFields(t: InvestmentTxnInput, accountId: number, categoryId: number | null): Linked {
  const amount = moneyMoved(t) ?? 0;
  if (t.action === 'dividend' || t.action === 'interest') {
    return { type: 'income', amount, accountId, toAccountId: null, categoryId };
  }
  const paid = t.action === 'buy' || t.action === 'deposit' || t.action === 'fee';
  return paid
    ? { type: 'transfer', amount, accountId, toAccountId: null, categoryId: null }
    : { type: 'transfer', amount, accountId: null, toAccountId: accountId, categoryId: null };
}

/** Add an investment transaction (id null) or change one. `assetId=new` creates the investment too. */
export async function saveInvestmentTxn(
  id: number | null,
  formData: FormData,
): Promise<ActionResult> {
  const fields = Object.fromEntries(formData);
  const parsed = investmentTxnSchema.safeParse(fields);
  // The new investment's fields sit in the same form; its note is the transaction's.
  const newAsset = fields.assetId === 'new' ? assetSchema.safeParse({ ...fields, note: '' }) : null;
  if (!parsed.success || (newAsset && !newAsset.success)) {
    return invalid(
      new z.ZodError([...(newAsset?.error?.issues ?? []), ...(parsed.error?.issues ?? [])]),
    );
  }
  const t = parsed.data;
  const existingId = id === null ? null : idSchema.safeParse(id);
  if (existingId && !existingId.success) return failed('That transaction no longer exists.');

  const result = db.transaction((tx): ActionResult => {
    // Everything is checked before anything is written.
    const asset =
      t.assetId === 'new' ? null : tx.select().from(assets).where(eq(assets.id, t.assetId)).get();
    if (t.assetId !== 'new' && !asset) return failed(GONE, 'assetId');
    const valuation = asset?.valuation ?? newAsset?.data?.valuation ?? 'units';
    if (!actionsFor(valuation).includes(t.action)) {
      return failed('Choose something this investment can record.', 'action');
    }

    const current = existingId
      ? tx
          .select()
          .from(investmentTransactions)
          .where(eq(investmentTransactions.id, existingId.data))
          .get()
      : null;
    if (existingId && !current) return failed('That transaction no longer exists.');

    const values = {
      date: t.date,
      action: t.action,
      units: t.units,
      price: t.price,
      amount: t.amount,
      fees: t.fees,
      splitFrom: t.splitFrom,
      splitTo: t.splitTo,
      note: t.note,
    };
    if (asset) {
      const problem =
        unitsProblem(asset.id, {
          remove: current?.id,
          add: { ...values, id: current?.id ?? Number.MAX_SAFE_INTEGER },
        }) ??
        (current && current.assetId !== asset.id
          ? unitsProblem(current.assetId, { remove: current.id })
          : null);
      if (problem) return failed(problem.message, problem.field);
    } else if (t.action === 'sell') {
      return failed('You only hold 0 units on that date.', 'units');
    }

    if (t.accountId && !tx.select().from(accounts).where(eq(accounts.id, t.accountId)).get()) {
      return failed('That account no longer exists. Choose another.', 'accountId');
    }
    let categoryId: number | null = null;
    if (t.accountId && (t.action === 'dividend' || t.action === 'interest')) {
      const name = t.action === 'dividend' ? 'Dividends' : 'Interest';
      categoryId =
        tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.name, name), eq(categories.kind, 'income')))
          .get()?.id ?? null;
      if (!categoryId) {
        return failed(
          `Add an income category called ${name} to link this to an account, or leave the account empty.`,
          'accountId',
        );
      }
    }

    // Writes.
    const assetId =
      asset?.id ?? tx.insert(assets).values(newAsset!.data!).returning({ id: assets.id }).get().id;
    const assetName = asset?.name ?? newAsset!.data!.name;

    let invId: number;
    if (current) {
      tx.update(investmentTransactions)
        .set({ ...values, assetId, updatedAt: now() })
        .where(eq(investmentTransactions.id, current.id))
        .run();
      invId = current.id;
    } else {
      invId = tx
        .insert(investmentTransactions)
        .values({ ...values, assetId })
        .returning({ id: investmentTransactions.id })
        .get().id;
    }

    const linked = tx
      .select()
      .from(transactions)
      .where(eq(transactions.investmentTxnId, invId))
      .get();
    if (!t.accountId) {
      if (linked) tx.delete(transactions).where(eq(transactions.id, linked.id)).run();
    } else {
      const row = { ...linkedFields(t, t.accountId, categoryId), date: t.date };
      const description = `${ACTION_LABELS[t.action]}, ${assetName}`;
      if (linked) {
        // Keep the owner's wording unless the action changed.
        const keep = current?.action === t.action;
        tx.update(transactions)
          .set({
            ...row,
            description: keep ? linked.description : description,
            updatedAt: now(),
          })
          .where(eq(transactions.id, linked.id))
          .run();
      } else {
        tx.insert(transactions)
          .values({ ...row, description, note: t.note, investmentTxnId: invId })
          .run();
      }
    }
    return { ok: true, id: invId };
  });

  if (result.ok) revalidate();
  return result;
}

/** Delete right away, with its linked Money row, and hand back a token for Undo. */
export async function deleteInvestmentTxn(id: number): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed('That transaction no longer exists.');

  const result = db.transaction((tx): ActionResult => {
    const inv = tx
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, parsedId.data))
      .get();
    if (!inv) return failed('That transaction was already deleted.');
    const problem = unitsProblem(inv.assetId, { remove: inv.id });
    if (problem) return failed(problem.message);
    const linked = tx
      .select()
      .from(transactions)
      .where(eq(transactions.investmentTxnId, inv.id))
      .get();
    // Cascades to the linked Money row.
    tx.delete(investmentTransactions).where(eq(investmentTransactions.id, inv.id)).run();
    const undo = keepForUndo(() =>
      db.transaction((tx2) => {
        if (unitsProblem(inv.assetId, { add: inv })) throw new Error('oversell');
        tx2.insert(investmentTransactions).values(inv).run();
        if (linked) tx2.insert(transactions).values(linked).run();
      }),
    );
    return { ok: true, id: inv.id, undo };
  });

  if (result.ok) revalidate();
  return result;
}

export async function undoInvestmentDelete(token: string): Promise<ActionResult> {
  const restore = takeUndo(token);
  if (!restore) return failed('Too late to undo that delete.');
  try {
    restore();
  } catch {
    return failed(
      'Could not undo: a later sale now needs those units, or its account was deleted.',
    );
  }
  revalidate();
  return { ok: true };
}

/* ---------- investments ---------- */

/** Change an investment's details. Its valuation can't change once it has transactions. */
export async function saveAsset(id: number, formData: FormData): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed(GONE);
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const a = parsed.data;

  const result = db.transaction((tx): ActionResult => {
    const current = tx.select().from(assets).where(eq(assets.id, parsedId.data)).get();
    if (!current) return failed(GONE);
    const used = tx
      .select({ id: investmentTransactions.id })
      .from(investmentTransactions)
      .where(eq(investmentTransactions.assetId, current.id))
      .get();
    if (used && current.valuation !== a.valuation) {
      return failed(
        'This investment has transactions, so pick a kind that is valued the same way.',
        'type',
      );
    }
    tx.update(assets)
      .set({ ...a, updatedAt: now() })
      .where(eq(assets.id, current.id))
      .run();
    return { ok: true, id: current.id };
  });

  if (result.ok) revalidate();
  return result;
}

/** Archive a sold investment, or restore it. */
export async function setAssetArchived(id: number, archived: boolean): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed(GONE);

  const result = db.transaction((tx): ActionResult => {
    const asset = tx.select().from(assets).where(eq(assets.id, parsedId.data)).get();
    if (!asset) return failed(GONE);
    if (archived) {
      const txns = tx
        .select()
        .from(investmentTransactions)
        .where(eq(investmentTransactions.assetId, asset.id))
        .all();
      if (!isSold(computeHolding(txns), asset.valuation)) {
        return failed('Sell or withdraw everything before archiving this investment.');
      }
    }
    tx.update(assets)
      .set({ archived: archived ? 1 : 0, updatedAt: now() })
      .where(eq(assets.id, asset.id))
      .run();
    return { ok: true, id: asset.id };
  });

  if (result.ok) revalidate();
  return result;
}

/* ---------- prices and values ---------- */

/**
 * Save new prices (units assets) and statement values (manual assets) for one date.
 * Fields are `u-<assetId>`; empty ones are skipped.
 */
export async function saveUpdates(formData: FormData): Promise<ActionResult> {
  const date = String(formData.get('date') ?? '');
  if (!isValidDate(date)) return failed('Pick the date these are from.', 'date');
  if (date > today()) return failed('Pick today or an earlier date.', 'date');

  const entries = [...formData.entries()].flatMap(([key, value]) => {
    const match = /^u-(\d+)$/.exec(key);
    const text = typeof value === 'string' ? value.trim() : '';
    return match && text ? [{ key, assetId: Number(match[1]), text }] : [];
  });
  if (!entries.length) return failed('Enter at least one new price or value.');

  const result = db.transaction((tx): ActionResult => {
    const fieldErrors: Record<string, string> = {};
    const writes: (() => void)[] = [];
    for (const { key, assetId, text } of entries) {
      const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
      if (!asset || asset.valuation === 'fd') {
        fieldErrors[key] = asset ? 'Fixed deposits are valued from their rate.' : GONE;
      } else if (asset.valuation === 'units') {
        const price = parseDecimal(text, 6);
        if (!price || Number(price) <= 0) fieldErrors[key] = 'Enter a price greater than zero.';
        else {
          writes.push(() =>
            tx
              .insert(prices)
              .values({ assetId, date, price, source: 'manual' })
              .onConflictDoUpdate({
                target: [prices.assetId, prices.date],
                set: { price, source: 'manual', updatedAt: now() },
              })
              .run(),
          );
        }
      } else {
        const value = parsePaise(text);
        if (!value.ok || value.value < 0) fieldErrors[key] = 'Enter a value of zero or more.';
        else {
          writes.push(() =>
            tx
              .insert(valuations)
              .values({ assetId, date, value: value.value })
              .onConflictDoUpdate({
                target: [valuations.assetId, valuations.date],
                set: { value: value.value, updatedAt: now() },
              })
              .run(),
          );
        }
      }
    }
    const first = Object.values(fieldErrors)[0];
    if (first) return { ok: false, message: first, fieldErrors };
    for (const write of writes) write();
    return { ok: true };
  });

  if (result.ok) revalidate();
  return result;
}
