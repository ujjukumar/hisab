import { Decimal } from 'decimal.js';
import type { Asset } from '@/lib/db/schema';
import { addDays, dayOfWeek, isValidDate, type IsoDate } from './dates';
import { computeHolding } from './holdings';
import type { PortfolioData } from './portfolio';
import { parseVrDate } from './valueResearch';

/** Reads AMFI NAVs and NSE/BSE bhavcopy into prices by ISIN (PLAN section 11, phase 8). */

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

/** AMFI scheme codes by ISIN, from NAVAll.txt, to look up a fund's NAV history. */
export function parseAmfiSchemeCodes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let cols: { isins: number[]; code: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(';').map((c) => c.trim());
    if (cells.length < 5) continue;
    if (!cols) {
      const isins = cells.flatMap((c, i) => (/^ISIN/i.test(c) ? [i] : []));
      const code = cells.findIndex((c) => /^Scheme Code$/i.test(c));
      if (isins.length && code >= 0) cols = { isins, code };
      continue;
    }
    const code = cells[cols.code] ?? '';
    if (!/^\d+$/.test(code)) continue;
    for (const i of cols.isins) {
      const isin = (cells[i] ?? '').toUpperCase();
      if (ISIN_RE.test(isin) && !out.has(isin)) out.set(isin, code);
    }
  }
  return out;
}

/**
 * A fund's full NAV history from mfapi.in (`{ meta, data: [{ date: 'dd-mm-yyyy', nav }] }`),
 * oldest first. Null when the answer is for a different fund or can't be read.
 */
export function parseMfapiHistory(body: unknown, isin: string): FeedPrice[] | null {
  if (!body || typeof body !== 'object') return null;
  const { meta, data } = body as { meta?: Record<string, unknown>; data?: unknown };
  const isins = [meta?.isin_growth, meta?.isin_div_reinvestment]
    .filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase());
  if (!isins.includes(isin.toUpperCase()) || !Array.isArray(data)) return null;
  const out = new Map<IsoDate, string>();
  for (const row of data) {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(row?.date ?? ''));
    const p = price(String(row?.nav ?? ''));
    if (!match || !p) continue;
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    if (isValidDate(date) && !out.has(date)) out.set(date, p);
  }
  return [...out].map(([date, p]) => ({ date, price: p })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Whether a benchmark's stored NAVs miss the start of the investments or the last week, so its
 * history should be fetched. A fund launched after `first` keeps a gap; callers try once.
 */
export function benchmarkNeedsHistory(dates: readonly IsoDate[], first: IsoDate, asOf: IsoDate): boolean {
  if (!dates.length) return true;
  let earliest = dates[0]!;
  let latest = dates[0]!;
  for (const date of dates) {
    if (date < earliest) earliest = date;
    if (date > latest) latest = date;
  }
  return earliest > addDays(first, 7) || latest < addDays(asOf, -7);
}

/**
 * NSE cash-market UDiFF and older CSV; BSE cash-market UDiFF and Equity-with-ISIN CSV.
 * An ISIN listed in several series keeps NSE's `EQ` or BSE's `A` close.
 */
export function parseBhavcopy(csv: string): PriceMap {
  const out: PriceMap = new Map();
  const eq = new Set<string>();
  const [head = '', ...lines] = csv.split(/\r?\n/);
  const names = csvCells(head).map((h) => h.trim().toUpperCase());
  const col = (...want: string[]) => names.findIndex((n) => want.includes(n));
  const isinAt = col('ISIN', 'ISIN_CODE');
  const closeAt = col('CLSPRIC', 'CLOSE');
  const dateAt = col('TRADDT', 'TIMESTAMP', 'TRADING_DATE');
  const seriesAt = col('SCTYSRS', 'SERIES', 'SC_GROUP');
  const sourceAt = col('SRC');
  if (isinAt < 0 || closeAt < 0 || dateAt < 0) return out;

  for (const line of lines) {
    const cells = csvCells(line).map((c) => c.trim());
    const isin = (cells[isinAt] ?? '').toUpperCase();
    const p = price(cells[closeAt]);
    const raw = cells[dateAt] ?? '';
    const date = isValidDate(raw) ? raw : parseVrDate(raw);
    if (!ISIN_RE.test(isin) || !p || !date || eq.has(isin)) continue;
    const preferred = names.includes('SC_GROUP') || cells[sourceAt]?.toUpperCase() === 'BSE' ? 'A' : 'EQ';
    const isEq = cells[seriesAt]?.toUpperCase() === preferred;
    if (isEq) eq.add(isin);
    if (isEq || !out.has(isin)) out.set(isin, { date, price: p });
  }
  return out;
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else value += char;
  }
  cells.push(value);
  return cells;
}

/** Automatic prices are checked at most once a calendar day. */
export function isDue(lastCheck: IsoDate | null, today: IsoDate): boolean {
  return lastCheck === null || lastCheck < today;
}

/** An investment whose price can come from a feed: funds from AMFI, stocks and ETFs from NSE. */
export type FeedAsset = {
  id: number;
  isin: string;
  feed: 'amfi' | 'nse';
  navStartDate?: IsoDate;
};

/** Unit-priced funds, stocks and ETFs whose symbol is an ISIN. Nothing else is ever priced automatically. */
export function feedAssets(assets: Asset[]): FeedAsset[] {
  return assets.flatMap((a): FeedAsset[] => {
    const isin = (a.symbol ?? '').trim().toUpperCase();
    if (a.valuation !== 'units' || !ISIN_RE.test(isin)) return [];
    if (a.type === 'mutual_fund') return [{
      id: a.id,
      isin,
      feed: 'amfi',
      ...(a.navStartDate ? { navStartDate: a.navStartDate as IsoDate } : {}),
    }];
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

/** Maximum lookback for a latest-price request or a manually requested weekly target. */
export const LOOK_BACK_DAYS = 7;
/** Days a source may take to publish a file before its absence is treated as final. */
export const PUBLISH_GRACE_DAYS = 3;
export const NO_MARKET_FILE_DATES_SETTING = 'price_no_market_file_dates';
export const ABSENT_PRICES_SETTING = 'price_absent_dates';

export type BenchmarkFeed = { id: number; isin: string };
export type PriceNeed = { date: IsoDate; linked: FeedAsset[]; cadence: 'daily'; benchmarks?: BenchmarkFeed[] };
/**
 * Settled gaps the backfill skips: dates when neither exchange published a file (listed
 * investments only), and investment-dates whose published file didn't list the investment.
 */
export type PriceGaps = { noFileDates?: ReadonlySet<IsoDate>; absent?: ReadonlySet<string> };

export function absentPriceKey(assetId: number, date: IsoDate): string {
  return `${assetId}:${date}`;
}

/**
 * Missing daily trading-date prices from each holding's first eligible date up to the day
 * before `asOf`. The day itself belongs to the latest-price check, not history.
 */
export function pastPriceNeeds(
  data: PortfolioData,
  asOf: IsoDate,
  gaps: PriceGaps = {},
  benchmarks: BenchmarkFeed[] = [],
  benchmarkDates: readonly { benchmarkId: number; date: IsoDate }[] = [],
): PriceNeed[] {
  const linked = feedAssets(data.assets);
  const ids = new Set(linked.map((a) => a.id));
  const txns = data.txns.filter((t) => ids.has(t.assetId));
  const startTxns = benchmarks.length ? data.txns : txns;
  const first = startTxns.reduce<IsoDate | null>(
    (m, t) => (m === null || t.date < m ? t.date : m),
    null,
  );
  if (first === null) return [];
  const priceDates = new Map<number, IsoDate[]>();
  for (const p of data.prices) {
    if (ids.has(p.assetId))
      priceDates.set(p.assetId, [...(priceDates.get(p.assetId) ?? []), p.date]);
  }

  const needs: PriceNeed[] = [];
  const benchmarkKnown = new Set(benchmarkDates.map((row) => `${row.benchmarkId}:${row.date}`));
  for (let date = first; date < asOf; date = addDays(date, 1)) {
    const weekday = dayOfWeek(date);
    if (weekday === 0 || weekday === 6) continue;
    const exchangesClosed = gaps.noFileDates?.has(date) ?? false;
    const missing = linked.filter((a) => {
      if (a.navStartDate && date < a.navStartDate) return false;
      if (exchangesClosed && a.feed === 'nse') return false;
      if (gaps.absent?.has(absentPriceKey(a.id, date))) return false;
      const own = txns.filter((t) => t.assetId === a.id && t.date <= date);
      if (own.length === 0 || computeHolding(own).units.lte(0)) return false;
      return !(priceDates.get(a.id) ?? []).includes(date);
    });
    const missingBenchmarks = benchmarks.filter((item) => !benchmarkKnown.has(`${item.id}:${date}`));
    if (missing.length || missingBenchmarks.length) needs.push({
      date, linked: missing, cadence: 'daily',
      ...(missingBenchmarks.length ? { benchmarks: missingBenchmarks } : {}),
    });
  }
  return needs;
}

export function priceWorkKey(need: Pick<PriceNeed, 'date' | 'cadence'>, assetId: number): string {
  return `${need.date}:${need.cadence}:${assetId}`;
}

export function benchmarkWorkKey(need: Pick<PriceNeed, 'date' | 'cadence'>, id: number): string {
  return `${need.date}:${need.cadence}:benchmark:${id}`;
}

export function pendingPriceNeeds(
  data: PortfolioData,
  asOf: IsoDate,
  attempted: ReadonlySet<string>,
  gaps: PriceGaps = {},
  benchmarks: BenchmarkFeed[] = [],
  benchmarkDates: readonly { benchmarkId: number; date: IsoDate }[] = [],
): PriceNeed[] {
  return pastPriceNeeds(data, asOf, gaps, benchmarks, benchmarkDates).flatMap((need) => {
    const linked = need.linked.filter((asset) => !attempted.has(priceWorkKey(need, asset.id)));
    const missing = need.benchmarks?.filter((item) => !attempted.has(benchmarkWorkKey(need, item.id))) ?? [];
    return linked.length || missing.length ? [{ ...need, linked,
      ...(missing.length ? { benchmarks: missing } : {}) }] : [];
  });
}
