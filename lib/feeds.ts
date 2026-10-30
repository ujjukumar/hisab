import 'server-only';
import { SHORT_MONTHS, addDays, parts, type IsoDate } from '@/lib/domain/dates';
import {
  LOOK_BACK_DAYS,
  parseAmfiNav,
  parseBhavcopy,
  parseYahooChart,
  type FeedPrice,
  type PriceMap,
} from '@/lib/domain/priceFeeds';
import { unzipFirst } from '@/lib/zip';

/**
 * The only place Hisaab goes online (PLAN section 11, phase 8). It downloads AMFI's and NSE's
 * public whole-market price files; every request is the same whatever the owner holds. The one
 * exception is a benchmark's history from Yahoo Finance, which names that market index (one the
 * owner chose to compare with, not a holding) and the date to start from.
 */

const HEADERS = { 'User-Agent': 'Hisaab (personal use)' };
const TIMEOUT_MS = 20_000;
const DEBUG_FEEDS = process.env.NODE_ENV === 'development' || process.env.HISAAB_PRICE_DEBUG === '1';
const AMFI_LATEST = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_HISTORY = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const NSE = 'https://nsearchives.nseindia.com/content';
const BSE = 'https://www.bseindia.com/download/BhavCopy/Equity';

export class FeedError extends Error {}
/** The source couldn't be reached or refused the request, so later dates would fail too. */
export class FeedUnreachableError extends FeedError {}
/** The source answered, but the day's file isn't ready (not published yet, or empty). */
export class FeedNotReadyError extends FeedError {}

/** The file, or null when the server says it doesn't exist (a holiday, or not published yet). */
async function download(url: string, source: string, headers = HEADERS): Promise<Buffer | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (DEBUG_FEEDS) console.error('[price-feed] request failed', { source, url, error });
    throw new FeedUnreachableError(`Couldn't reach ${source}. Check the internet connection and try again.`);
  }
  if (DEBUG_FEEDS) {
    console.info('[price-feed] response', {
      source,
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentEncoding: res.headers.get('content-encoding'),
      contentLength: res.headers.get('content-length'),
    });
  }
  if (res.status === 404) return null;
  if (!res.ok)
    throw new FeedUnreachableError(`${source} didn't send its prices (error ${res.status}). Try again later.`);
  const body = Buffer.from(await res.arrayBuffer());
  if (DEBUG_FEEDS) console.info('[price-feed] body read', { source, bytes: body.byteLength });
  return body;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Every fund's latest NAV. */
export async function amfiLatest(): Promise<PriceMap> {
  const file = await download(AMFI_LATEST, 'AMFI');
  const map = file ? parseAmfiNav(file.toString('utf8')) : new Map();
  if (map.size === 0) throw new FeedError("AMFI's NAV list was empty. Try again later.");
  return map;
}

/** A market index's daily closes from `from` to today, oldest first, from Yahoo Finance. */
export async function indexHistory(symbol: string, from: IsoDate): Promise<FeedPrice[]> {
  const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const end = Math.floor(Date.now() / 1000) + 86_400;
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d`;
  // Yahoo turns away requests that don't look like they come from a browser.
  const file = await download(url, 'Yahoo Finance', { 'User-Agent': 'Mozilla/5.0' });
  let body: unknown = null;
  try {
    body = file ? JSON.parse(file.toString('utf8')) : null;
  } catch {
    body = null;
  }
  const history = parseYahooChart(body);
  if (!history?.length) throw new FeedError("Yahoo Finance didn't send this index's history. Try again later.");
  return history;
}

/** Fund NAVs published for one day. Weekend lists hold only the few funds priced every day. */
export async function amfiOn(date: IsoDate): Promise<PriceMap> {
  const { year, month, day } = parts(date);
  const dayText = `${pad(day)}-${SHORT_MONTHS[month - 1]}-${year}`;
  const url = `${AMFI_HISTORY}?frmdt=${dayText}&todt=${dayText}`;
  const file = await download(url, 'AMFI');
  if (!file) return new Map();
  const text = file.toString('utf8');
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) {
    if (DEBUG_FEEDS) console.error('[price-feed] AMFI returned HTML instead of NAV data', { date });
    // AMFI answers with a webpage for a day it hasn't published yet.
    throw new FeedNotReadyError(`AMFI returned a webpage instead of NAV data for ${date}. Try again later.`);
  }
  return parseAmfiNav(text);
}

/** NAVs on `date`, or the nearest earlier day when a weekly target allows lookback. */
export async function amfiFor(
  date: IsoDate,
  isins: string[],
  lookBackDays = LOOK_BACK_DAYS,
  earliestDates: ReadonlyMap<string, IsoDate> = new Map(),
): Promise<PriceMap> {
  const out: PriceMap = new Map();
  let notReady: FeedNotReadyError | null = null;
  for (let i = 0; i < lookBackDays && out.size < isins.length; i++) {
    const dayDate = addDays(date, -i);
    const eligible = isins.filter(
      (isin) => !out.has(isin) && dayDate >= (earliestDates.get(isin) ?? dayDate),
    );
    if (eligible.length === 0) continue;
    let day: PriceMap;
    try {
      day = await amfiOn(dayDate);
    } catch (error) {
      if (!(error instanceof FeedNotReadyError)) throw error;
      notReady ??= error;
      continue;
    }
    if (DEBUG_FEEDS) {
      console.info('[price-feed] AMFI history lookup', {
        targetDate: date,
        fileDate: dayDate,
        requested: eligible.length,
        parsedInstruments: day.size,
        matched: eligible.filter((isin) => day.has(isin)).length,
      });
    }
    for (const isin of eligible) {
      const found = day.get(isin);
      if (found?.date === dayDate && !out.has(isin)) out.set(isin, found);
    }
  }
  if (notReady && out.size === 0) throw notReady;
  return out;
}

/** One trading day's closing prices, or null when NSE has no file for that day. */
async function nseOn(date: IsoDate): Promise<PriceMap | null> {
  const { year, month, day } = parts(date);
  const mon = SHORT_MONTHS[month - 1]?.toUpperCase() ?? '';
  const udiff = `${NSE}/cm/BhavCopy_NSE_CM_0_0_0_${year}${pad(month)}${pad(day)}_F_0000.csv.zip`;
  const older = `${NSE}/historical/EQUITIES/${year}/${mon}/cm${pad(day)}${mon}${year}bhav.csv.zip`;
  // UDiFF files go back to January 2024; the older format stops in July 2024.
  for (const url of date >= '2024-01-01' ? [udiff, older] : [older, udiff]) {
    const file = await download(url, 'NSE');
    if (!file) continue;
    try {
      return parseBhavcopy(unzipFirst(file).toString('utf8'));
    } catch {
      throw new FeedError("NSE's closing prices couldn't be read. Try again later.");
    }
  }
  return null;
}

/** Closing prices on `date`, or the last trading day within a requested lookback. */
export async function nseLatest(
  date: IsoDate,
  lookBackDays = LOOK_BACK_DAYS,
  isins?: readonly string[],
): Promise<PriceMap> {
  if (isins) {
    const out: PriceMap = new Map();
    const requested = new Set(isins);
    for (let i = 0; i < lookBackDays && out.size < requested.size; i++) {
      const fileDate = addDays(date, -i);
      const map = await nseOn(fileDate);
      if (DEBUG_FEEDS) {
        console.info('[price-feed] NSE history lookup', {
          targetDate: date,
          fileDate,
          fileFound: map !== null,
          parsedInstruments: map?.size ?? 0,
          matched: [...requested].filter((isin) => map?.has(isin)).length,
        });
      }
      if (!map) continue;
      for (const isin of requested) {
        const found = map.get(isin);
        if (found && !out.has(isin)) out.set(isin, found);
      }
    }
    return out;
  }
  for (let i = 0; i < lookBackDays; i++) {
    const map = await nseOn(addDays(date, -i));
    if (map) return map;
  }
  return new Map();
}

/** BSE equity cash-market bhavcopy, UDiFF from 8 July 2024, Equity-with-ISIN before then. */
async function bseOn(date: IsoDate): Promise<PriceMap | null> {
  const { year, month, day } = parts(date);
  const ymd = `${year}${pad(month)}${pad(day)}`;
  const old = `${pad(day)}${pad(month)}${String(year).slice(-2)}`;
  const url = date >= '2024-07-08'
    ? `${BSE}/BhavCopy_BSE_CM_0_0_0_${ymd}_F_0000.CSV`
    : `${BSE}/EQ_ISINCODE_${old}.CSV`;
  const file = await download(url, 'BSE');
  if (!file) return null;
  const text = file.toString('utf8');
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) return null;
  const map = parseBhavcopy(text);
  if (!map.size) throw new FeedNotReadyError("BSE's closing prices couldn't be read. Try again later.");
  return map;
}

/** Exact-day exchange prices and whether either whole-market file was published. */
export async function listedPricesOn(
  date: IsoDate,
  isins: readonly string[],
): Promise<{ prices: PriceMap; marketFileFound: boolean }> {
  const prices: PriceMap = new Map();
  const nse = await nseOn(date);
  if (nse) {
    for (const isin of isins) {
      const price = nse.get(isin);
      if (price) prices.set(isin, price);
    }
  }

  const missing = isins.filter((isin) => !prices.has(isin));
  const bse = missing.length ? await bseOn(date) : null;
  if (bse) {
    for (const isin of missing) {
      const price = bse.get(isin);
      if (price) prices.set(isin, price);
    }
  }
  return { prices, marketFileFound: nse !== null || bse !== null };
}

/** BSE's whole-market closes, used locally for ISINs not present in NSE's file. */
export async function bseLatest(
  date: IsoDate,
  lookBackDays = LOOK_BACK_DAYS,
  isins?: readonly string[],
): Promise<PriceMap> {
  let notReady: FeedNotReadyError | null = null;
  const fileOn = async (fileDate: IsoDate) => {
    try {
      return await bseOn(fileDate);
    } catch (error) {
      if (!(error instanceof FeedNotReadyError)) throw error;
      notReady ??= error;
      return null;
    }
  };
  if (isins) {
    const out: PriceMap = new Map();
    const requested = new Set(isins);
    for (let i = 0; i < lookBackDays && out.size < requested.size; i++) {
      const fileDate = addDays(date, -i);
      const map = await fileOn(fileDate);
      if (DEBUG_FEEDS) {
        console.info('[price-feed] BSE history lookup', {
          targetDate: date,
          fileDate,
          fileFound: map !== null,
          parsedInstruments: map?.size ?? 0,
          matched: [...requested].filter((isin) => map?.has(isin)).length,
        });
      }
      if (!map) continue;
      for (const isin of requested) {
        const found = map.get(isin);
        if (found && !out.has(isin)) out.set(isin, found);
      }
    }
    if (notReady && out.size === 0) throw notReady;
    return out;
  }
  for (let i = 0; i < lookBackDays; i++) {
    const map = await fileOn(addDays(date, -i));
    if (map) return map;
  }
  if (notReady) throw notReady;
  return new Map();
}
