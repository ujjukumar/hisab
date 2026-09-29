import { Decimal } from 'decimal.js';
import type { Asset } from '@/lib/db/schema';
import { daysBetween, type IsoDate } from './dates';
import { byDateThenId, unitsAmount, type Holding, type HoldingTxn } from './holdings';
import type { Paise } from './money';

type Dated = { date: IsoDate };

/** The last row dated on or before `date`, and the one before it. Rows can be in any order. */
export function latestTwo<T extends Dated>(rows: T[], date: IsoDate): [T | null, T | null] {
  const upTo = rows.filter((r) => r.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1));
  return [upTo[0] ?? null, upTo[1] ?? null];
}

const PERIODS = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 } as const;

/**
 * Principal × (1 + r/n)^(n·t), or × (1 + r·t) for simple interest, with t in
 * years (days ÷ 365) from `start` to the earlier of `date` and maturity.
 */
export function fdValue(fd: {
  principal: Paise;
  rate: string;
  compounding: Asset['compounding'];
  start: IsoDate;
  maturity: IsoDate | null;
  date: IsoDate;
}): Paise {
  const end = fd.maturity && fd.maturity < fd.date ? fd.maturity : fd.date;
  const t = new Decimal(Math.max(0, daysBetween(fd.start, end))).div(365);
  const r = new Decimal(fd.rate).div(100);
  const p = new Decimal(fd.principal);
  if (fd.compounding === 'simple') return p.times(r.times(t).plus(1)).round().toNumber();
  const n = PERIODS[fd.compounding ?? 'quarterly'];
  return p
    .times(r.div(n).plus(1).pow(t.times(n)))
    .round()
    .toNumber();
}

export type Price = { date: IsoDate; price: string };
export type Valued = {
  value: Paise;
  /** The latest price used, for units assets. */
  price: Price | null;
  /** Units asset with no price entered: valued at the last buy price. */
  stale: boolean;
  /** Change from the previous price to the latest; null with fewer than two prices. */
  sinceLast: { change: Paise; previousValue: Paise; since: IsoDate } | null;
};

/** Current value on `date` for any valuation method (PLAN section 6). */
export function valueOn(
  asset: Pick<Asset, 'valuation' | 'interestRate' | 'compounding' | 'startDate' | 'maturityDate'>,
  holding: Holding,
  txns: HoldingTxn[],
  data: { prices: Price[]; valuations: { date: IsoDate; value: Paise }[] },
  date: IsoDate,
): Valued {
  const none = { price: null, stale: false, sinceLast: null };

  if (asset.valuation === 'units') {
    if (holding.units.lte(0)) return { value: 0, ...none };
    const [latest, previous] = latestTwo(data.prices, date);
    if (!latest) {
      const fallback = holding.lastBuyPrice ?? '0';
      return { value: unitsAmount(holding.units, fallback), ...none, stale: true };
    }
    const value = unitsAmount(holding.units, latest.price);
    const previousValue = previous ? unitsAmount(holding.units, previous.price) : 0;
    return {
      value,
      price: latest,
      stale: false,
      sinceLast: previous
        ? { change: value - previousValue, previousValue, since: previous.date }
        : null,
    };
  }

  if (holding.cost <= 0) return { value: 0, ...none };

  if (asset.valuation === 'fd') {
    const first = [...txns].sort(byDateThenId)[0]?.date ?? date;
    return {
      value: fdValue({
        principal: holding.cost,
        rate: asset.interestRate ?? '0',
        compounding: asset.compounding,
        start: asset.startDate ?? first,
        maturity: asset.maturityDate,
        date,
      }),
      ...none,
    };
  }

  // Manual: the last statement balance, plus anything paid in or taken out since it.
  const [statement] = latestTwo(data.valuations, date);
  if (!statement) return { value: holding.cost, ...none };
  let value = statement.value;
  for (const t of txns) {
    if (t.date <= statement.date || t.date > date) continue;
    if (t.action === 'deposit') value += t.amount ?? 0;
    if (t.action === 'withdrawal') value -= t.amount ?? 0;
  }
  return { value, ...none };
}
