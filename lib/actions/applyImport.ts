import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/connect';
import { accounts, assets, investmentTransactions, prices, transactions } from '@/lib/db/schema';
import { ACTION_LABELS } from '@/lib/domain/assets';
import { linkedMoneyRow } from '@/lib/domain/holdings';
import type { VrFile } from '@/lib/domain/valueResearch';
import { planImport, type ImportChoices } from '@/lib/queries/imports';

/**
 * The writes behind `importTransactions`, kept out of the 'use server' file so tests can run
 * them on their own database. Plans again inside the transaction, so a preview that has gone
 * stale can't import anything twice.
 */

export const NOTHING_NEW =
  'Everything in this file is already in Hisaab, so there is nothing to import.';

export function applyImport(
  db: Db,
  file: VrFile,
  choices: ImportChoices,
  accountId: number | null,
): { ok: true; added: number } | { ok: false; message: string } {
  return db.transaction((tx) => {
    const plan = planImport(db, file, choices);
    const [problem] = plan.problems;
    if (problem) return { ok: false, message: problem };
    if (!plan.add.length) return { ok: false, message: NOTHING_NEW };
    if (accountId && !tx.select().from(accounts).where(eq(accounts.id, accountId)).get()) {
      return { ok: false, message: 'That account no longer exists. Choose another.' };
    }

    const ids = new Map<string, { id: number; name: string }>();
    for (const inv of plan.investments) {
      if (inv.assetId !== null) {
        if (inv.setSymbol) {
          tx.update(assets)
            .set({ symbol: inv.isin, updatedAt: new Date().toISOString() })
            .where(eq(assets.id, inv.assetId))
            .run();
        }
        ids.set(inv.isin, { id: inv.assetId, name: inv.assetName ?? inv.name });
      } else if (inv.toAdd > 0) {
        const name = inv.name.slice(0, 80).trim();
        const { id } = tx
          .insert(assets)
          .values({
            name,
            type: inv.type,
            assetClass: inv.assetClass,
            valuation: 'units',
            symbol: inv.isin,
            accountRef: inv.accountRef?.slice(0, 60) || null,
          })
          .returning({ id: assets.id })
          .get();
        ids.set(inv.isin, { id, name });
      }
    }

    for (const r of plan.add) {
      const asset = ids.get(r.isin)!;
      const { id } = tx
        .insert(investmentTransactions)
        .values({
          assetId: asset.id,
          date: r.date,
          action: r.action,
          units: r.units,
          price: r.price,
          amount: r.amount,
          fees: r.fees,
          note: 'Imported from Value Research',
        })
        .returning({ id: investmentTransactions.id })
        .get();
      // A worked-out price isn't a real NAV, so it doesn't go into the price history.
      if (!r.priceAdjusted) {
        tx.insert(prices)
          .values({ assetId: asset.id, date: r.date, price: r.price, source: 'import' })
          .onConflictDoNothing()
          .run();
      }
      if (accountId) {
        tx.insert(transactions)
          .values({
            ...linkedMoneyRow(r, accountId, null),
            date: r.date,
            description: `${ACTION_LABELS[r.action]}, ${asset.name}`,
            investmentTxnId: id,
          })
          .run();
      }
    }
    return { ok: true, added: plan.add.length };
  });
}
