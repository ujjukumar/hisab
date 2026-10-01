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
 * ponytail: two sources, no retries, and a plain User-Agent. If NSE starts refusing it, stocks
 * and ETFs report the failure while funds still update; BSE's bhavcopy is the fallback to add.
 */

const HEADERS = { 'User-Agent': 'Hisaab (personal use)' };
const TIMEOUT_MS = 20_000;
const AMFI_LATEST = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_HISTORY = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const NSE = 'https://nsearchives.nseindia.com/content';

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
  } catch {
    throw new FeedError(`Couldn't reach ${source}. Check the internet connection and try again.`);
  }
  if (res.status === 404) return null;
  if (!res.ok)
    throw new FeedError(`${source} didn't send its prices (error ${res.status}). Try again later.`);
  return Buffer.from(await res.arrayBuffer());
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
  return file ? parseAmfiNav(file.toString('utf8')) : new Map();
}

/** NAVs on `date`, or the nearest earlier day when a weekly target allows lookback. */
export async function amfiFor(
  date: IsoDate,
  isins: string[],
  lookBackDays = LOOK_BACK_DAYS,
): Promise<PriceMap> {
  const out: PriceMap = new Map();
  for (let i = 0; i < lookBackDays && out.size < isins.length; i++) {
    const dayDate = addDays(date, -i);
    const day = await amfiOn(dayDate);
    for (const isin of isins) {
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
export async function nseLatest(date: IsoDate, lookBackDays = LOOK_BACK_DAYS): Promise<PriceMap> {
  for (let i = 0; i < lookBackDays; i++) {
    const map = await nseOn(addDays(date, -i));
    if (map) return map;
  }
  if (lookBackDays === 1) return new Map();
  throw new FeedError('NSE had no closing prices for the week. Try again later.');
}
