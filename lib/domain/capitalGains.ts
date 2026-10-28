import { Decimal } from 'decimal.js';
import type { Asset } from '@/lib/db/schema';
import { addMonthsToDate, type IsoDate } from './dates';
import { byDateThenId, OversellError, type HoldingTxn } from './holdings';
import type { Paise } from './money';

/** Capital gains by FIFO lots for the Tax tab (PLAN section 6, Tax). Holdings keep average cost. */

/**
 * How a matched sale is taxed:
 * equity_short and equity_long are listed equity at special rates, other_long is any other
 * long-term gain at a flat rate, slab is taxed with ordinary income. indexation and
 * grandfathered are left out of the estimate and shown for checking.
 */
export type GainKind =
  | 'equity_short'
  | 'equity_long'
  | 'other_long'
  | 'slab'
  | 'indexation'
  | 'grandfathered';

export type TaxAsset = Pick<Asset, 'id' | 'name' | 'type' | 'assetClass'>;

export type SaleLot = {
  assetId: number;
  saleTxnId: number;
  bought: IsoDate;
  sold: IsoDate;
  units: Decimal;
  cost: Paise;
  proceeds: Paise;
  gain: Paise;
  term: 'short' | 'long';
  kind: GainKind;
  /** Percent, null when taxed at slab rates or left out. */
  rate: number | null;
};

export type IntradayResult = { assetId: number; date: IsoDate; amount: Paise };

/** How each treatment reads in the Tax tab. */
export const GAIN_KIND_LABELS: Record<GainKind, string> = {
  equity_short: 'Short-term, shares and equity funds',
  equity_long: 'Long-term, shares and equity funds',
  other_long: 'Long-term, other investments',
  slab: 'Taxed with income',
  indexation: 'Left out: may use indexation',
  grandfathered: 'Left out: bought before Feb 2018',
};

/** Rates and holding periods changed for transfers on or after this date. */
export const RATE_CHANGE: IsoDate = '2024-07-23';
/** Non-equity funds bought on or after this date are taxed at slab rates. */
const SPECIFIED_FROM: IsoDate = '2023-04-01';
/** From this date only debt funds are taxed that way; gold and overseas funds are not. */
const SPECIFIED_NARROWED: IsoDate = '2025-04-01';
/** Equity bought before this is grandfathered at its 31 Jan 2018 value, which is not covered. */
const GRANDFATHER_BEFORE: IsoDate = '2018-02-01';

const isLong = (bought: IsoDate, sold: IsoDate, months: number) =>
  sold > addMonthsToDate(bought, months);

/** The tax treatment of units bought on one date and sold on another. */
export function classifySale(
  asset: Pick<Asset, 'type' | 'assetClass'>,
  bought: IsoDate,
  sold: IsoDate,
): { term: 'short' | 'long'; kind: GainKind; rate: number | null } {
  const before = sold < RATE_CHANGE;
  const fund = asset.type === 'mutual_fund' || asset.type === 'etf';
  const equity = asset.type === 'stock' || (fund && asset.assetClass === 'equity');

  if (equity) {
    if (!isLong(bought, sold, 12)) {
      return { term: 'short', kind: 'equity_short', rate: before ? 15 : 20 };
    }
    if (bought < GRANDFATHER_BEFORE) return { term: 'long', kind: 'grandfathered', rate: null };
    return { term: 'long', kind: 'equity_long', rate: before ? 10 : 12.5 };
  }

  if (fund) {
    const specified =
      bought >= SPECIFIED_FROM && (asset.assetClass === 'debt' || sold < SPECIFIED_NARROWED);
    if (specified) return { term: 'short', kind: 'slab', rate: null };
  }

  const months = before ? 36 : asset.type === 'etf' ? 12 : 24;
  if (!isLong(bought, sold, months)) return { term: 'short', kind: 'slab', rate: null };
  if (before) return { term: 'long', kind: 'indexation', rate: null };
  return { term: 'long', kind: 'other_long', rate: 12.5 };
}

type Lot = { date: IsoDate; units: Decimal; cost: Decimal };

/**
 * Replay an asset's transactions by date, then id, matching each sale to the oldest units
 * first. A lot's cost is units × price plus the buy's fees; a sale's proceeds are its amount
 * less fees, shared across the lots it takes by units. Splits scale units and keep cost and
 * date. Fees recorded on their own are not part of cost.
 */
export function realisedLots(
  asset: TaxAsset,
  txns: HoldingTxn[],
): { lots: SaleLot[]; intraday: IntradayResult[] } {
  const open: Lot[] = [];
  const lots: SaleLot[] = [];
  const intraday: IntradayResult[] = [];

  for (const t of [...txns].sort(byDateThenId)) {
    const u = new Decimal(t.units ?? 0);
    const amount = t.amount ?? 0;
    if (t.action === 'buy') {
      if (u.gt(0)) open.push({ date: t.date, units: u, cost: new Decimal(amount + t.fees) });
    } else if (t.action === 'split') {
      if (t.splitFrom && t.splitTo) {
        for (const lot of open) lot.units = lot.units.times(t.splitTo).div(t.splitFrom);
      }
    } else if (t.action === 'intraday') {
      intraday.push({ assetId: asset.id, date: t.date, amount: amount - t.fees });
    } else if (t.action === 'sell') {
      const held = open.reduce((s, l) => s.plus(l.units), new Decimal(0));
      if (u.gt(held)) throw new OversellError(held, t.id);
      const net = new Decimal(amount - t.fees);
      let left = u;
      let proceedsLeft = net;
      while (left.gt(0)) {
        const lot = open[0]!;
        const take = Decimal.min(lot.units, left);
        const cost = take.eq(lot.units) ? lot.cost : lot.cost.times(take).div(lot.units);
        const last = take.eq(left);
        const proceeds = last ? proceedsLeft : net.times(take).div(u);
        const costP = cost.round().toNumber();
        const proceedsP = proceeds.round().toNumber();
        lots.push({
          assetId: asset.id,
          saleTxnId: t.id,
          bought: lot.date,
          sold: t.date,
          units: take,
          cost: costP,
          proceeds: proceedsP,
          gain: proceedsP - costP,
          ...classifySale(asset, lot.date, t.date),
        });
        proceedsLeft = proceedsLeft.minus(proceedsP);
        lot.units = lot.units.minus(take);
        lot.cost = lot.cost.minus(cost);
        if (lot.units.isZero()) open.shift();
        left = left.minus(take);
      }
    }
  }
  return { lots, intraday };
}

export type SpecialGain = { kind: 'equity_short' | 'equity_long' | 'other_long'; rate: number; gain: Paise };

export type GainSummary = {
  /** Net gains taxed with ordinary income, never below zero. */
  slab: Paise;
  /** Net gains at special rates after losses, highest rate first, only those above zero. */
  special: SpecialGain[];
  /** Losses not used this year. */
  shortLossLeft: Paise;
  longLossLeft: Paise;
  /** Matched sales left out of the estimate: needing indexation or grandfathering. */
  leftOut: SaleLot[];
};

/**
 * Net the year's matched sales, then set losses off in a fixed order: a short-term loss
 * against short-term equity, slab-rate, other long-term and long-term equity gains; a
 * long-term loss against other long-term, then long-term equity gains. Higher rates first.
 */
export function summariseGains(lots: SaleLot[]): GainSummary {
  const buckets = new Map<string, { kind: GainKind; rate: number | null; term: 'short' | 'long'; gain: number }>();
  const leftOut: SaleLot[] = [];
  for (const l of lots) {
    if (l.kind === 'indexation' || l.kind === 'grandfathered') {
      leftOut.push(l);
      continue;
    }
    const key = `${l.kind}:${l.rate ?? ''}`;
    const b = buckets.get(key) ?? { kind: l.kind, rate: l.rate, term: l.term, gain: 0 };
    b.gain += l.gain;
    buckets.set(key, b);
  }

  let shortLoss = 0;
  let longLoss = 0;
  for (const b of buckets.values()) {
    if (b.gain >= 0) continue;
    if (b.term === 'short') shortLoss -= b.gain;
    else longLoss -= b.gain;
    b.gain = 0;
  }

  const rank = (b: { kind: GainKind; rate: number | null }) => {
    const order: GainKind[] = ['equity_short', 'slab', 'other_long', 'equity_long'];
    return order.indexOf(b.kind) * 1000 - (b.rate ?? 0);
  };
  const ordered = [...buckets.values()].sort((a, b) => rank(a) - rank(b));
  const setOff = (loss: number, kinds: GainKind[]) => {
    for (const b of ordered) {
      if (loss <= 0) break;
      if (!kinds.includes(b.kind) || b.gain <= 0) continue;
      const used = Math.min(loss, b.gain);
      b.gain -= used;
      loss -= used;
    }
    return loss;
  };
  const shortLossLeft = setOff(shortLoss, ['equity_short', 'slab', 'other_long', 'equity_long']);
  const longLossLeft = setOff(longLoss, ['other_long', 'equity_long']);

  return {
    slab: ordered.filter((b) => b.kind === 'slab').reduce((s, b) => s + b.gain, 0),
    special: ordered
      .filter((b): b is typeof b & SpecialGain => b.kind !== 'slab' && b.gain > 0 && b.rate !== null)
      .map(({ kind, rate, gain }) => ({ kind, rate, gain }))
      .sort((a, b) => b.rate - a.rate || rank(a) - rank(b)),
    shortLossLeft,
    longLossLeft,
    leftOut,
  };
}
