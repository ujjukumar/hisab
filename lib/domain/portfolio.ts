import type { Asset } from '@/lib/db/schema';
import { groupOf, type GroupKey } from './assets';
import type { IsoDate } from './dates';
import { computeHolding, isSold, type Holding, type HoldingTxn } from './holdings';
import type { Paise } from './money';
import { valueOn, type Price, type Valued } from './valuation';
import { annualReturn, type CashFlow, type Return } from './xirr';

/** Everything the portfolio is worked out from, as loaded from the database. */
export type PortfolioData = {
  assets: Asset[];
  txns: (HoldingTxn & { assetId: number })[];
  prices: (Price & { assetId: number })[];
  valuations: { assetId: number; date: IsoDate; value: Paise }[];
};

export type HoldingRow = Valued & {
  asset: Asset;
  group: GroupKey;
  holding: Holding;
  sold: boolean;
  /** Value − cost while held; the realised gain once sold. */
  totalReturn: Paise;
  ret: Return;
  /** Cash flows including the current value, dated `date`. */
  flows: CashFlow[];
};

function byAsset<T extends { assetId: number }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(row.assetId);
    if (list) list.push(row);
    else map.set(row.assetId, [row]);
  }
  return map;
}

/** Every asset's holding and value on `date`. Transactions after `date` are left out. */
export function buildPortfolio(data: PortfolioData, date: IsoDate): HoldingRow[] {
  const txns = byAsset(data.txns.filter((t) => t.date <= date));
  const prices = byAsset(data.prices);
  const valuations = byAsset(data.valuations);
  return data.assets.map((asset) => {
    const own = txns.get(asset.id) ?? [];
    const holding = computeHolding(own);
    const valued = valueOn(
      asset,
      holding,
      own,
      { prices: prices.get(asset.id) ?? [], valuations: valuations.get(asset.id) ?? [] },
      date,
    );
    const sold = isSold(holding, asset.valuation);
    const flows = [...holding.flows, { date, amount: valued.value }];
    return {
      ...valued,
      asset,
      group: groupOf(asset.type),
      holding,
      sold,
      totalReturn: sold ? holding.realised : valued.value - holding.cost,
      ret: annualReturn(flows, date),
      flows,
    };
  });
}

export type Totals = {
  value: Paise;
  /** Cost of what is still held. */
  invested: Paise;
  totalReturn: Paise;
  /** Value + everything paid out − everything paid in (PLAN section 6, All-time returns). */
  allTime: Paise;
  /** Change since the previous price, over holdings that have two prices. */
  change: { amount: Paise; percent: number; since: IsoDate } | null;
  ret: Return;
};

/** Sums for a set of holdings: a group's totals row, or the whole portfolio for the strip. */
export function totals(rows: HoldingRow[], date: IsoDate): Totals {
  let value = 0;
  let invested = 0;
  let totalReturn = 0;
  let allTime = 0;
  let change = 0;
  let previous = 0;
  let since: IsoDate | null = null;
  for (const r of rows) {
    value += r.value;
    invested += r.sold ? 0 : r.holding.cost;
    totalReturn += r.totalReturn;
    allTime += r.value + r.holding.inflows + r.holding.income - r.holding.outflows;
    if (r.sinceLast) {
      change += r.sinceLast.change;
      previous += r.sinceLast.previousValue;
      if (!since || r.sinceLast.since < since) since = r.sinceLast.since;
    }
  }
  return {
    value,
    invested,
    totalReturn,
    allTime,
    change: since
      ? { amount: change, percent: previous ? (change / previous) * 100 : 0, since }
      : null,
    ret: annualReturn(
      rows.flatMap((r) => r.flows),
      date,
    ),
  };
}
