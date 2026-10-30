import 'server-only';
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/lib/db/client';
import {
  accounts,
  assets,
  investmentTransactions,
  prices,
  settings,
  transactions,
  valuations,
  type Asset,
  type InvestmentAction,
} from '@/lib/db/schema';
import { GROUPS, groupOf, maskRef, type GroupKey } from '@/lib/domain/assets';
import {
  isValidDate,
  today,
  type IsoDate,
} from '@/lib/domain/dates';
import { formatDate } from '@/lib/domain/format';
import { computeHolding, moneyMoved, OversellError, type HoldingTxn } from '@/lib/domain/holdings';
import type { Paise } from '@/lib/domain/money';
import {
  choosePeriod,
  investmentPeriodRows,
  periodRows,
  periodStart,
  sampleHistoryDates,
} from '@/lib/domain/performance';
import { buildPortfolio, type HoldingRow, type PortfolioData } from '@/lib/domain/portfolio';
import {
  ABSENT_PRICES_SETTING,
  NO_MARKET_FILE_DATES_SETTING,
  pastPriceNeeds,
  type PriceGaps,
} from '@/lib/domain/priceFeeds';
import { INVESTMENT_ACTIONS } from '@/lib/validation/investments';
import { PAGE_SIZE, paramReader, type Params } from './money';

const txnColumns = {
  id: investmentTransactions.id,
  assetId: investmentTransactions.assetId,
  date: investmentTransactions.date,
  action: investmentTransactions.action,
  units: investmentTransactions.units,
  price: investmentTransactions.price,
  sellPrice: investmentTransactions.sellPrice,
  amount: investmentTransactions.amount,
  fees: investmentTransactions.fees,
  splitFrom: investmentTransactions.splitFrom,
  splitTo: investmentTransactions.splitTo,
};

function allTxns(): (HoldingTxn & { assetId: number })[] {
  return db.select(txnColumns).from(investmentTransactions).all();
}

/**
 * The oversell check for a change to one asset: its transactions with `remove` taken out
 * and `add` put in. Returns what to tell the owner, or null when every sale is still covered.
 */
export function unitsProblem(
  assetId: number,
  change: { remove?: number; add?: HoldingTxn },
): { message: string; field?: string } | null {
  const txns: HoldingTxn[] = db
    .select(txnColumns)
    .from(investmentTransactions)
    .where(eq(investmentTransactions.assetId, assetId))
    .all()
    .filter((t) => t.id !== change.remove);
  if (change.add) txns.push(change.add);
  try {
    computeHolding(txns);
    return null;
  } catch (error) {
    if (!(error instanceof OversellError)) throw error;
    if (error.txnId === change.add?.id) return { message: error.message, field: 'units' };
    const sale = txns.find((t) => t.id === error.txnId);
    return {
      message: `That would leave the sale on ${formatDate(sale?.date ?? '')} selling more units than you hold. Change that sale first.`,
    };
  }
}

// ponytail: the whole portfolio is replayed from every transaction on each request.
// Fine for one household's few hundred rows; cache holdings per asset if it ever drags.
/** Everything the portfolio is worked out from, loaded once per request. */
export const freshPortfolioData = (): PortfolioData => ({
  assets: db.select().from(assets).orderBy(asc(assets.name)).all(),
  txns: allTxns(),
  prices: db
    .select({ assetId: prices.assetId, date: prices.date, price: prices.price })
    .from(prices)
    .all(),
  valuations: db
    .select({ assetId: valuations.assetId, date: valuations.date, value: valuations.value })
    .from(valuations)
    .all(),
});

export const portfolioData = cache(freshPortfolioData);

/** Every asset's holding and value on `date`, worked out once per request. */
export const portfolio = cache((date: IsoDate = today()): HoldingRow[] =>
  buildPortfolio(portfolioData(), date),
);

/** The Overview's `?group=` and `?sold=1`, applied to the portfolio. Shared with its CSV export. */
export function pickHoldings(all: HoldingRow[], params: Params) {
  const { one } = paramReader(params);
  const showSold = one('sold') === '1';
  const g = one('group');
  const group = GROUPS.some((x) => x.key === g) ? (g as GroupKey) : null;
  return {
    showSold,
    group,
    rows: all.filter((r) => (showSold || !r.sold) && (!group || r.group === group)),
  };
}

/* ---------- drawer choices ---------- */

export type AssetOption = Pick<
  Asset,
  | 'id'
  | 'name'
  | 'type'
  | 'assetClass'
  | 'valuation'
  | 'symbol'
  | 'navStartDate'
  | 'accountRef'
  | 'interestRate'
  | 'compounding'
  | 'startDate'
  | 'maturityDate'
  | 'note'
> & {
  group: GroupKey;
  archived: boolean;
  sold: boolean;
  /** The latest price, to prefill a buy or sell. */
  lastPrice: string | null;
  /** Date of the latest entered price; null when it is the last buy price. */
  priceDate: IsoDate | null;
  /** The latest value, shown beside manual assets in the update drawer. */
  value: Paise;
};

export function assetOptions(): AssetOption[] {
  return portfolio().map((r) => ({
    id: r.asset.id,
    name: r.asset.name,
    type: r.asset.type,
    assetClass: r.asset.assetClass,
    valuation: r.asset.valuation,
    symbol: r.asset.symbol,
    navStartDate: r.asset.navStartDate,
    accountRef: r.asset.accountRef,
    interestRate: r.asset.interestRate,
    compounding: r.asset.compounding,
    startDate: r.asset.startDate,
    maturityDate: r.asset.maturityDate,
    note: r.asset.note,
    group: r.group,
    archived: r.asset.archived === 1,
    sold: r.sold,
    lastPrice: r.price?.price ?? r.holding.lastBuyPrice,
    priceDate: r.price?.date ?? null,
    value: r.value,
  }));
}

/* ---------- investment transactions ---------- */

export type InvTxnFilters = {
  from: IsoDate | null;
  to: IsoDate | null;
  action: InvestmentAction | null;
  group: GroupKey | null;
  assetId: number | null;
  q: string;
  sort: InvTxnSort;
  dir: 'asc' | 'desc';
  limit: number;
};

export const INV_TXN_SORTS = ['date', 'asset', 'action', 'price', 'units', 'balance', 'amount', 'fees', 'account'] as const;
export type InvTxnSort = (typeof INV_TXN_SORTS)[number];

export function parseInvTxnFilters(params: Params): InvTxnFilters {
  const { one, id, limit } = paramReader(params);
  const from = isValidDate(one('from')) ? one('from') : null;
  const to = isValidDate(one('to')) ? one('to') : null;
  const swap = from && to && from > to;
  const action = one('action');
  const group = one('group');
  return {
    from: swap ? to : from,
    to: swap ? from : to,
    action: (INVESTMENT_ACTIONS as readonly string[]).includes(action)
      ? (action as InvestmentAction)
      : null,
    group: GROUPS.some((g) => g.key === group) ? (group as GroupKey) : null,
    assetId: id('asset'),
    q: one('q').slice(0, 100),
    sort: (INV_TXN_SORTS as readonly string[]).includes(one('sort'))
      ? (one('sort') as InvTxnSort)
      : 'date',
    dir: one('dir') === 'asc' ? 'asc' : 'desc',
    limit: limit(),
  };
}

export function invTxnFilterParams(f: InvTxnFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.action) p.set('action', f.action);
  if (f.group) p.set('group', f.group);
  if (f.assetId) p.set('asset', String(f.assetId));
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'date') p.set('sort', f.sort);
  if (f.dir !== 'desc') p.set('dir', f.dir);
  if (f.limit !== PAGE_SIZE) p.set('limit', String(f.limit));
  return p;
}

export type InvTxnRow = HoldingTxn & {
  assetId: number;
  assetName: string;
  /** Intraday only. */
  sellPrice: string | null;
  /** Masked folio or demat number. */
  ref: string;
  group: GroupKey;
  valuation: Asset['valuation'];
  note: string | null;
  /** Units held after this transaction; null for manual and FD assets. */
  balanceUnits: string | null;
  accountId: number | null;
  accountName: string | null;
  /** Money that moved: paid for buys, deposits and fees; received for the rest; an intraday result, negative for a loss. Null for splits. */
  total: Paise | null;
};

export function listInvestmentTxns(
  f: InvTxnFilters,
  options: { all?: boolean; id?: number } = {},
): { rows: InvTxnRow[]; count: number } {
  const pattern = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const group = GROUPS.find((g) => g.key === f.group);
  const where = and(
    options.id ? eq(investmentTransactions.id, options.id) : undefined,
    f.from ? gte(investmentTransactions.date, f.from) : undefined,
    f.to ? lte(investmentTransactions.date, f.to) : undefined,
    f.action ? eq(investmentTransactions.action, f.action) : undefined,
    group ? inArray(assets.type, group.types) : undefined,
    f.assetId ? eq(investmentTransactions.assetId, f.assetId) : undefined,
    f.q
      ? or(
          sql`${assets.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${investmentTransactions.note} LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined,
  );

  const total =
    db
      .select({ n: count() })
      .from(investmentTransactions)
      .innerJoin(assets, eq(investmentTransactions.assetId, assets.id))
      .where(where)
      .get()?.n ?? 0;

  const query = db
    .select({
      ...txnColumns,
      note: investmentTransactions.note,
      assetName: assets.name,
      accountRef: assets.accountRef,
      type: assets.type,
      valuation: assets.valuation,
      accountId: accounts.id,
      accountName: accounts.name,
    })
    .from(investmentTransactions)
    .innerJoin(assets, eq(investmentTransactions.assetId, assets.id))
    .leftJoin(transactions, eq(transactions.investmentTxnId, investmentTransactions.id))
    .leftJoin(
      accounts,
      sql`${accounts.id} = coalesce(${transactions.accountId}, ${transactions.toAccountId})`,
    )
    .where(where)
    .orderBy(desc(investmentTransactions.date), desc(investmentTransactions.id));
  const found = query.all();

  // Balance units need every earlier transaction of the asset, not just the filtered ones.
  const unitsAfter = new Map<number, string>();
  const byAsset = new Map<number, HoldingTxn[]>();
  for (const t of allTxns()) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
  for (const assetId of new Set(found.map((r) => r.assetId))) {
    for (const [id, u] of computeHolding(byAsset.get(assetId) ?? []).unitsAfter) {
      unitsAfter.set(id, u.toFixed());
    }
  }

  const rows = found.map(({ accountRef, type, ...r }) => ({
    ...r,
    ref: maskRef(accountRef),
    group: groupOf(type),
    balanceUnits: r.valuation === 'units' ? (unitsAfter.get(r.id) ?? null) : null,
    total: moneyMoved(r),
  }));
  const sortValue = (row: InvTxnRow): string | number | null => {
    switch (f.sort) {
      case 'date': return row.date;
      case 'asset': return row.assetName;
      case 'action': return row.action;
      case 'price': return row.price ? Number(row.price) : null;
      case 'units': return row.units ? Number(row.units) : null;
      case 'balance': return row.balanceUnits ? Number(row.balanceUnits) : null;
      case 'amount': return row.total;
      case 'fees': return row.fees;
      case 'account': return row.accountName;
    }
  };
  const sorted = [...rows].sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    if (leftValue === null || rightValue === null) {
      if (leftValue !== rightValue) return leftValue === null ? 1 : -1;
    } else {
      const order = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      if (order !== 0) return f.dir === 'asc' ? order : -order;
    }
    return right.date.localeCompare(left.date) || right.id - left.id;
  });
  return { rows: options.all ? sorted : sorted.slice(0, f.limit), count: total };
}

/** One investment transaction, for the drawer opened from a Money row's "Open investment transaction". */
export function getInvestmentTxn(id: number): InvTxnRow | null {
  return listInvestmentTxns(parseInvTxnFilters({}), { id }).rows[0] ?? null;
}

/* ---------- holding detail ---------- */

export type HistoryPoint = { date: IsoDate; invested: Paise; worth: Paise };

/**
 * Invested vs worth for one holding: at each price or statement date (month-ends for
 * FDs), plus today. Prices before the first transaction are left out.
 */
export function holdingHistory(assetId: number, from: IsoDate | null = null): HistoryPoint[] {
  const data = portfolioData();
  const asset = data.assets.find((a) => a.id === assetId);
  const first = data.txns
    .filter((t) => t.assetId === assetId)
    .map((t) => t.date)
    .sort()[0];
  if (!asset || !first) return [];
  const own: PortfolioData = {
    assets: [asset],
    txns: data.txns.filter((t) => t.assetId === assetId),
    prices: data.prices.filter((p) => p.assetId === assetId),
    valuations: data.valuations.filter((v) => v.assetId === assetId),
  };
  const end = today();
  return sampleHistoryDates(own, first, end, from, true)
    .map((date) => {
      const [row] = buildPortfolio(own, date);
      return { date, invested: row?.holding.cost ?? 0, worth: row?.value ?? 0 };
    });
}

/* ---------- performance ---------- */

/** The Performance tab's `?asof=`, `?period=` and custom `?from=`, and each holding's figures for them. Shared with its CSV export. */
export function periodPerformance(params: Params, yearStartMonth: number) {
  const { one } = paramReader(params);
  const now = today();
  const asked = one('asof');
  const asOf = isValidDate(asked) && asked <= now ? asked : now;
  const { period, customFrom } = choosePeriod(one('period'), one('from'), asOf);
  const data = portfolioData();
  if (period === 'custom') return { asOf, period, from: customFrom, rows: periodRows(data, customFrom, asOf) };
  const rows = investmentPeriodRows(data, period, asOf, yearStartMonth);
  const fallback = periodStart(period, asOf, yearStartMonth);
  const from = period === '1d'
    ? rows.reduce<IsoDate>((earliest, row) => row.from && row.from < earliest ? row.from : earliest, fallback!)
    : fallback;
  return { asOf, period, from, rows };
}

/** Scheduled daily prices still missing for linked investments. */
export function pastPriceDates(): {
  date: IsoDate;
  funds: boolean;
  listed: boolean;
  cadence: 'daily';
}[] {
  return pastPriceNeeds(portfolioData(), today(), priceGaps()).map((n) => ({
    date: n.date,
    cadence: n.cadence,
    funds: n.linked.some((a) => a.feed === 'amfi'),
    listed: n.linked.some((a) => a.feed === 'nse'),
  }));
}

function stringListSetting(key: string): string[] {
  const row = db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, key)).get();
  if (!row?.value) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Dates when neither exchange had a whole-market file in a settled backfill run. */
export function noMarketFileDates(): Set<IsoDate> {
  return new Set(stringListSetting(NO_MARKET_FILE_DATES_SETTING).filter(isValidDate));
}

/** `assetId:date` pairs whose settled source file didn't list the investment. */
export function absentPriceKeys(): Set<string> {
  return new Set(stringListSetting(ABSENT_PRICES_SETTING));
}

export function priceGaps(): PriceGaps {
  return { noFileDates: noMarketFileDates(), absent: absentPriceKeys() };
}
