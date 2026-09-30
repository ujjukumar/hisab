import { Decimal } from 'decimal.js';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db/connect';
import { assets, investmentTransactions, type Asset } from '@/lib/db/schema';
import { formatDate } from '@/lib/domain/format';
import { OversellError, computeHolding, type HoldingTxn } from '@/lib/domain/holdings';
import { guessAssetClass, type VrFile, type VrRow, type VrType } from '@/lib/domain/valueResearch';

/**
 * What importing a Value Research file would do (PLAN section 11, phase 7). Read-only; the import
 * action runs it again inside its transaction. Takes the connection so tests can pass their own.
 */

export type ImportChoices = {
  /** Per ISIN: an existing investment's id, or 'new'. Missing means "work it out". */
  match: Record<string, number | 'new'>;
  assetClass: Record<string, Asset['assetClass']>;
};

export type PlannedInvestment = {
  isin: string;
  name: string;
  type: VrType;
  accountRef: string | null;
  assetClass: Asset['assetClass'];
  /** The existing investment it goes into, or null for a new one. */
  assetId: number | null;
  assetName: string | null;
  /** Already linked by ISIN, so the owner can't change it here. */
  fixed: boolean;
  /** The existing investment has no ISIN yet, so the import fills it in. */
  setSymbol: boolean;
  toAdd: number;
};

export type PlannedRow = VrRow & { key: number };

export type ImportPlan = {
  investments: PlannedInvestment[];
  add: PlannedRow[];
  duplicates: number;
  skipped: VrFile['skipped'];
  problems: string[];
  /** Investments priced by units, for "Add as". */
  options: { id: number; name: string }[];
};

const dedupeKey = (t: { date: string; action: string; units: string | null }) =>
  `${t.date}|${t.action}|${new Decimal(t.units ?? 0).toString()}`;

export function planImport(
  db: Db,
  file: VrFile,
  choices: ImportChoices = { match: {}, assetClass: {} },
): ImportPlan {
  const unitAssets = db
    .select({ id: assets.id, name: assets.name, symbol: assets.symbol })
    .from(assets)
    .where(eq(assets.valuation, 'units'))
    .orderBy(assets.name)
    .all();
  const bySymbol = new Map(
    unitAssets.filter((a) => a.symbol).map((a) => [a.symbol!.trim().toUpperCase(), a]),
  );
  const byId = new Map(unitAssets.map((a) => [a.id, a]));
  const problems = [...file.problems];

  // One entry per ISIN, in the order the file first mentions it.
  const investments = new Map<string, PlannedInvestment>();
  for (const r of file.rows) {
    if (investments.has(r.isin)) continue;
    const linked = bySymbol.get(r.isin);
    const choice = choices.match[r.isin];
    const chosen =
      linked ??
      (choice === 'new'
        ? undefined
        : choice !== undefined
          ? byId.get(choice)
          : unitAssets.find(
              (a) => !a.symbol && a.name.trim().toLowerCase() === r.name.toLowerCase(),
            ));
    if (!linked && choice !== undefined && choice !== 'new' && !chosen) {
      problems.push(`The investment chosen for ${r.name} no longer exists. Choose another.`);
    }
    investments.set(r.isin, {
      isin: r.isin,
      name: r.name,
      type: r.type,
      accountRef: r.accountRef,
      assetClass: choices.assetClass[r.isin] ?? guessAssetClass(r.name, r.type),
      assetId: chosen?.id ?? null,
      assetName: chosen?.name ?? null,
      fixed: !!linked,
      setSymbol: !!chosen && !chosen.symbol,
      toAdd: 0,
    });
  }

  const assetIds = [...new Set([...investments.values()].flatMap((i) => i.assetId ?? []))];
  const existing: (HoldingTxn & { assetId: number })[] = assetIds.length
    ? db
        .select({
          id: investmentTransactions.id,
          assetId: investmentTransactions.assetId,
          date: investmentTransactions.date,
          action: investmentTransactions.action,
          units: investmentTransactions.units,
          price: investmentTransactions.price,
          amount: investmentTransactions.amount,
          fees: investmentTransactions.fees,
          splitFrom: investmentTransactions.splitFrom,
          splitTo: investmentTransactions.splitTo,
        })
        .from(investmentTransactions)
        .where(inArray(investmentTransactions.assetId, assetIds))
        .all()
    : [];

  // Rows already in Hisaab, counted so a file with two identical rows still imports both once.
  const seen = new Map<string, number>();
  for (const t of existing) {
    const k = `${t.assetId}|${dedupeKey(t)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const add: PlannedRow[] = [];
  let duplicates = 0;
  let nextId = Math.max(0, ...existing.map((t) => t.id)) + 1;
  for (const r of file.rows) {
    const inv = investments.get(r.isin)!;
    const k = `${inv.assetId ?? `new-${r.isin}`}|${dedupeKey(r)}`;
    const n = seen.get(k) ?? 0;
    if (n > 0) {
      seen.set(k, n - 1);
      duplicates++;
      continue;
    }
    add.push({ ...r, key: nextId++ });
    inv.toAdd++;
  }

  // Replay each investment with the new rows, so a sale is never more than was held.
  const groups = new Map<string, HoldingTxn[]>();
  const group = (k: string) => groups.get(k) ?? groups.set(k, []).get(k)!;
  for (const t of existing) group(String(t.assetId)).push(t);
  for (const r of add) {
    const inv = investments.get(r.isin)!;
    group(String(inv.assetId ?? r.isin)).push({ ...r, id: r.key, splitFrom: null, splitTo: null });
  }
  for (const txns of groups.values()) {
    try {
      computeHolding(txns);
    } catch (error) {
      if (!(error instanceof OversellError)) throw error;
      const t = txns.find((x) => x.id === error.txnId);
      const row = add.find((r) => r.key === error.txnId);
      problems.push(
        `The sale of ${row?.name ?? 'an investment'} on ${t ? formatDate(t.date) : 'one date'} is more than was held then. Import the All-time history, or add the earlier buys first.`,
      );
    }
  }

  return {
    investments: [...investments.values()],
    add,
    duplicates,
    skipped: file.skipped,
    problems,
    options: unitAssets.map(({ id, name }) => ({ id, name })),
  };
}
