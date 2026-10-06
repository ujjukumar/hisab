import 'server-only';
import { SHORT_MONTHS, addDays, parts, type IsoDate } from '@/lib/domain/dates';
import {
  LOOK_BACK_DAYS,
  parseAmfiNav,
  parseBhavcopy,
  type PriceMap,
} from '@/lib/domain/priceFeeds';
import { unzipFirst } from '@/lib/zip';

/**
 * The only place Hisaab goes online (PLAN section 11, phase 8). It downloads AMFI's and NSE's
 * public whole-market price files; every request is the same whatever the owner holds.
 */

const HEADERS = { 'User-Agent': 'Hisaab (personal use)' };
const TIMEOUT_MS = 20_000;
const DEBUG_FEEDS = process.env.NODE_ENV === 'development' || process.env.HISAAB_PRICE_DEBUG === '1';
const AMFI_LATEST = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_HISTORY = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const NSE = 'https://nsearchives.nseindia.com/content';
const BSE = 'https://www.bseindia.com/download/BhavCopy/Equity';

export class FeedError extends Error {}

/** The file, or null when the server says it doesn't exist (a holiday, or not published yet). */
async function download(url: string, source: string): Promise<Buffer | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (DEBUG_FEEDS) console.error('[price-feed] request failed', { source, url, error });
    throw new FeedError(`Couldn't reach ${source}. Check the internet connection and try again.`);
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
    throw new FeedError(`${source} didn't send its prices (error ${res.status}). Try again later.`);
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

/** Fund NAVs published for one day. Weekend lists hold only the few funds priced every day. */
async function amfiOn(date: IsoDate): Promise<PriceMap> {
  const { year, month, day } = parts(date);
  const dayText = `${pad(day)}-${SHORT_MONTHS[month - 1]}-${year}`;
  const url = `${AMFI_HISTORY}?frmdt=${dayText}&todt=${dayText}`;
  const file = await download(url, 'AMFI');
  if (!file) return new Map();
  const text = file.toString('utf8');
  if (/^\s*(?:<!doctype html|<html\b)/i.test(text)) {
    if (DEBUG_FEEDS) console.error('[price-feed] AMFI returned HTML instead of NAV data', { date });
    throw new FeedError(`AMFI returned a webpage instead of NAV data for ${date}. Try again later.`);
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
  for (let i = 0; i < lookBackDays && out.size < isins.length; i++) {
    const dayDate = addDays(date, -i);
    const eligible = isins.filter(
      (isin) => !out.has(isin) && dayDate >= (earliestDates.get(isin) ?? dayDate),
    );
    if (eligible.length === 0) continue;
    const day = await amfiOn(dayDate);
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
  if (!map.size) throw new FeedError("BSE's closing prices couldn't be read. Try again later.");
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
  if (isins) {
    const out: PriceMap = new Map();
    const requested = new Set(isins);
    for (let i = 0; i < lookBackDays && out.size < requested.size; i++) {
      const fileDate = addDays(date, -i);
      const map = await bseOn(fileDate);
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
    return out;
  }
  for (let i = 0; i < lookBackDays; i++) {
    const map = await bseOn(addDays(date, -i));
    if (map) return map;
  }
  return new Map();
}
