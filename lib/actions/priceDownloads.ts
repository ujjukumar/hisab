import { applyFeedPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import {
  LOOK_BACK_DAYS,
  PUBLISH_GRACE_DAYS,
  pricesFor,
  type FeedAsset,
  type PriceMap,
} from '@/lib/domain/priceFeeds';
import { addDays, today, type IsoDate } from '@/lib/domain/dates';
import {
  FeedError,
  FeedNotReadyError,
  FeedUnreachableError,
  bseLatest,
  listedPricesOn,
  nseLatest,
} from '@/lib/feeds';

const DEBUG_FEEDS = process.env.NODE_ENV === 'development' || process.env.HISAAB_PRICE_DEBUG === '1';

function maskIsin(isin: string): string {
  return `${isin.slice(0, 3)}***${isin.slice(-4)}`;
}

export type FetchResult = {
  updated: number;
  problems: string[];
  /** A source failed for this date. */
  unavailable: boolean;
  /** A source couldn't be reached at all, so later dates would fail too. */
  unreachable: boolean;
  /** Neither exchange published a file for this date (daily backfill only). */
  noMarketFile: boolean;
  /** Investments a settled, published file didn't list on this date (daily backfill only). */
  absent: number[];
};

export async function fetchAndSave(
  linked: FeedAsset[],
  date: IsoDate,
  funds: (isins: string[], earliestDates: ReadonlyMap<string, IsoDate>) => Promise<PriceMap>,
  lookBackDays = LOOK_BACK_DAYS,
  canSave: () => boolean = () => true,
  dailyBackfill = false,
): Promise<FetchResult> {
  const amfi = linked.filter((a) => a.feed === 'amfi');
  const nse = linked.filter((a) => a.feed === 'nse');
  const earliestDates = new Map(
    amfi.flatMap((asset) => asset.navStartDate ? [[asset.isin, asset.navStartDate] as const] : []),
  );
  const fundIsins = [...new Set(amfi.map((asset) => asset.isin))];
  // In a daily backfill, a file missing after the grace period is final; before it, try again later.
  const settled = dailyBackfill && date <= addDays(today(), -PUBLISH_GRACE_DAYS);
  const none: PriceMap = new Map();
  let noMarketFile = false;
  let marketFileFound = !dailyBackfill;
  const listedRequest = !nse.length
    ? Promise.resolve(none)
    : dailyBackfill
      ? listedPricesOn(date, nse.map((asset) => asset.isin)).then((result) => {
          noMarketFile = !result.marketFileFound;
          marketFileFound = result.marketFileFound;
          return result.prices;
        })
      : nseLatest(date, lookBackDays, nse.map((asset) => asset.isin));
  const got = await Promise.allSettled([
    fundIsins.length ? funds(fundIsins, earliestDates) : none,
    listedRequest,
  ]);
  const problems: string[] = [];
  let unavailable = false;
  let unreachable = false;
  const fail = (reason: unknown) => {
    if (!(reason instanceof FeedError)) throw reason;
    if (reason instanceof FeedNotReadyError && dailyBackfill && !settled) return;
    if (!problems.includes(reason.message)) problems.push(reason.message);
    unavailable = true;
    if (reason instanceof FeedUnreachableError) unreachable = true;
  };
  const absent: number[] = [];

  const fundResult = got[0]!;
  let fundRows: ReturnType<typeof pricesFor> = [];
  if (fundIsins.length && fundResult.status === 'rejected') {
    fail(fundResult.reason);
  } else if (fundIsins.length && fundResult.status === 'fulfilled') {
    const fundMap = dailyBackfill ? new Map([...fundResult.value].filter(([isin, found]) =>
      found.date === date && date >= (earliestDates.get(isin) ?? date))) : fundResult.value;
    fundRows = pricesFor(amfi, fundMap);
    const missing = amfi.length - fundRows.length;
    if (settled && fundResult.value.size) {
      absent.push(...amfi.filter((asset) => !fundRows.some((row) => row.assetId === asset.id))
        .map((asset) => asset.id));
    } else if (missing && !dailyBackfill) {
      problems.push(
        `AMFI had no price for ${missing === 1 ? '1 investment' : `${missing} investments`}. Check the ISIN in each one.`,
      );
    }
  }

  const nseResult = got[1]!;
  if (nseResult.status === 'rejected' && !(nseResult.reason instanceof FeedError))
    throw nseResult.reason;
  const nseMap = nseResult.status === 'fulfilled' ? nseResult.value : none;
  const missingNse = nse.filter((asset) => !nseMap.has(asset.isin));
  let bseMap: PriceMap = none;
  if (missingNse.length && !dailyBackfill) {
    try {
      bseMap = await bseLatest(date, lookBackDays, missingNse.map((a) => a.isin));
    } catch (error) {
      fail(error);
    }
  }
  const nseRows = pricesFor(nse, nseMap);
  const bseRows = pricesFor(missingNse, bseMap);
  const listedRows = nseRows.concat(bseRows);
  const missing = nse.length - listedRows.length;
  if (missing && nseResult.status === 'rejected') {
    fail(nseResult.reason);
  } else if (dailyBackfill) {
    if (settled && missing && marketFileFound) {
      absent.push(...nse.filter((asset) => !listedRows.some((row) => row.assetId === asset.id))
        .map((asset) => asset.id));
    }
  } else if (missing && !unavailable) {
    if (nseMap.size === 0 && bseMap.size === 0) {
      if (lookBackDays > 1)
        problems.push('NSE and BSE had no closing prices for this week. Run again later to retry.');
    } else {
      problems.push(
        `NSE and BSE had no price for ${missing === 1 ? '1 investment' : `${missing} investments`}. Check the ISIN in each one.`,
      );
    }
  }
  const rows = [...fundRows, ...listedRows];
  if (DEBUG_FEEDS) {
    const missingAssets = linked.filter((asset) => !rows.some((row) => row.assetId === asset.id));
    console.info('[price-feed] lookup summary', {
      targetDate: date,
      lookBackDays,
      matched: rows.map(({ assetId, date: priceDate }) => ({ assetId, date: priceDate })),
      missing: missingAssets.map(({ id, isin, feed }) => ({
        assetId: id,
        isin: maskIsin(isin),
        feed,
      })),
      sources: {
        amfi: { requested: amfi.length, matched: fundRows.length },
        nse: { requested: nse.length, matched: nseRows.length },
        bse: { requested: missingNse.length, matched: bseRows.length },
      },
      unavailable,
      noMarketFile,
      absent,
      problems,
    });
  }
  return {
    updated: canSave() && rows.length ? applyFeedPrices(db, rows) : 0,
    problems,
    unavailable,
    unreachable,
    noMarketFile,
    absent,
  };
}
