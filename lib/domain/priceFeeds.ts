import { Decimal } from 'decimal.js';
import type { Asset } from '@/lib/db/schema';
import {
  addDays,
  isValidDate,
  monthEndsBetween,
  monthOf,
  type IsoDate,
  type IsoMonth,
} from './dates';
import { computeHolding } from './holdings';
import type { PortfolioData } from './portfolio';
import { parseVrDate } from './valueResearch';

/** Reads AMFI's NAV files and NSE's bhavcopy into prices by ISIN (PLAN section 11, phase 8). */

export type FeedPrice = { date: IsoDate; price: string };
export type PriceMap = Map<string, FeedPrice>;

export const ISIN_RE = /^IN[A-Z0-9]{10}$/;

/** A positive price with up to 6 decimals, as a plain decimal string. */
function price(text: string | undefined): string | null {
  const s = (text ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s) || !/[1-9]/.test(s)) return null;
  return new Decimal(s).toFixed();
}

/**
 * AMFI's `;`-separated NAV lists: the latest one (NAVAll.txt) and the history report for a date.
 * Columns are found by header name because the two files order them differently; fund house
 * and category headings, blank lines and `N.A.` NAVs are skipped.
 */
export function parseAmfiNav(text: string): PriceMap {
  const out: PriceMap = new Map();
  let cols: { isins: number[]; nav: number; date: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(';').map((c) => c.trim());
    if (cells.length < 5) continue;
    if (!cols) {
      const at = (re: RegExp) => cells.findIndex((c) => re.test(c));
      const isins = cells.flatMap((c, i) => (/^ISIN/i.test(c) ? [i] : []));
      const nav = at(/^Net Asset Value$/i);
      const date = at(/^Date$/i);
      if (isins.length && nav >= 0 && date >= 0) cols = { isins, nav, date };
      continue;
    }
    const p = price(cells[cols.nav]);
    const date = parseVrDate(cells[cols.date]);
    if (!p || !date) continue;
    for (const i of cols.isins) {
      const isin = (cells[i] ?? '').toUpperCase();
      if (ISIN_RE.test(isin) && !out.has(isin)) out.set(isin, { date, price: p });
    }
  }
  return out;
}

/**
 * NSE's cash-market bhavcopy CSV, in either format: UDiFF (from 2024: `ISIN`, `ClsPric`,
 * `TradDt`, `SctySrs`) or the older one (`ISIN`, `CLOSE`, `TIMESTAMP`, `SERIES`).
 * An ISIN listed in several series keeps its `EQ` close, otherwise the first one.
 */
export function parseBhavcopy(csv: string): PriceMap {
  const out: PriceMap = new Map();
  const eq = new Set<string>();
  const [head = '', ...lines] = csv.split(/\r?\n/);
  const names = head.split(',').map((h) => h.trim().toUpperCase());
  const col = (...want: string[]) => names.findIndex((n) => want.includes(n));
  const isinAt = col('ISIN');
  const closeAt = col('CLSPRIC', 'CLOSE');
  const dateAt = col('TRADDT', 'TIMESTAMP');
  const seriesAt = col('SCTYSRS', 'SERIES');
  if (isinAt < 0 || closeAt < 0 || dateAt < 0) return out;

  for (const line of lines) {
    const cells = line.split(',').map((c) => c.trim());
    const isin = (cells[isinAt] ?? '').toUpperCase();
    const p = price(cells[closeAt]);
    const raw = cells[dateAt] ?? '';
    const date = isValidDate(raw) ? raw : parseVrDate(raw);
    if (!ISIN_RE.test(isin) || !p || !date || eq.has(isin)) continue;
    const isEq = cells[seriesAt]?.toUpperCase() === 'EQ';
    if (isEq) eq.add(isin);
    if (isEq || !out.has(isin)) out.set(isin, { date, price: p });
  }
  return out;
}

/** Automatic prices are checked at most once a calendar day. */
export function isDue(lastCheck: IsoDate | null, today: IsoDate): boolean {
  return lastCheck === null || lastCheck < today;
}

/** An investment whose price can come from a feed: funds from AMFI, stocks and ETFs from NSE. */
export type FeedAsset = { id: number; isin: string; feed: 'amfi' | 'nse' };

/** Unit-priced funds, stocks and ETFs whose symbol is an ISIN. Nothing else is ever priced automatically. */
export function feedAssets(assets: Asset[]): FeedAsset[] {
  return assets.flatMap((a): FeedAsset[] => {
    const isin = (a.symbol ?? '').trim().toUpperCase();
    if (a.valuation !== 'units' || !ISIN_RE.test(isin)) return [];
    if (a.type === 'mutual_fund') return [{ id: a.id, isin, feed: 'amfi' }];
    if (a.type === 'stock' || a.type === 'etf') return [{ id: a.id, isin, feed: 'nse' }];
    return [];
  });
}

/** The feed prices for these investments, as rows for the prices table. */
export function pricesFor(
  linked: FeedAsset[],
  map: PriceMap,
): { assetId: number; date: IsoDate; price: string }[] {
  return linked.flatMap((a) => {
    const found = map.get(a.isin);
    return found ? [{ assetId: a.id, ...found }] : [];
  });
}

/** Past prices are looked for up to a week before each month-end, for weekends and holidays. */
export const LOOK_BACK_DAYS = 7;

export type PriceNeed = { date: IsoDate; linked: FeedAsset[] };

/**
 * Month-ends, from the first transaction to `lastMonth`, where a linked investment was held but
 * has no price in the week up to that day. These are what "Fetch past prices" downloads.
 */
export function pastPriceNeeds(data: PortfolioData, lastMonth: IsoMonth): PriceNeed[] {
  const linked = feedAssets(data.assets);
  const ids = new Set(linked.map((a) => a.id));
  const txns = data.txns.filter((t) => ids.has(t.assetId));
  const first = txns.reduce<IsoDate | null>(
    (m, t) => (m === null || t.date < m ? t.date : m),
    null,
  );
  if (first === null) return [];
  const priceDates = new Map<number, IsoDate[]>();
  for (const p of data.prices) {
    if (ids.has(p.assetId))
      priceDates.set(p.assetId, [...(priceDates.get(p.assetId) ?? []), p.date]);
  }

  return monthEndsBetween(monthOf(first), lastMonth).flatMap((date) => {
    const from = addDays(date, 1 - LOOK_BACK_DAYS);
    const missing = linked.filter((a) => {
      const own = txns.filter((t) => t.assetId === a.id && t.date <= date);
      if (own.length === 0 || computeHolding(own).units.lte(0)) return false;
      return !(priceDates.get(a.id) ?? []).some((d) => d >= from && d <= date);
    });
    return missing.length ? [{ date, linked: missing }] : [];
  });
}
