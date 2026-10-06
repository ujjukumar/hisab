import { applyFeedPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import { LOOK_BACK_DAYS, pricesFor, type FeedAsset, type PriceMap } from '@/lib/domain/priceFeeds';
import type { IsoDate } from '@/lib/domain/dates';
import { FeedError, bseLatest, listedPricesOn, nseLatest } from '@/lib/feeds';

const DEBUG_FEEDS = process.env.NODE_ENV === 'development' || process.env.HISAAB_PRICE_DEBUG === '1';

function maskIsin(isin: string): string {
  return `${isin.slice(0, 3)}***${isin.slice(-4)}`;
}

export async function fetchAndSave(
  linked: FeedAsset[],
  date: IsoDate,
  funds: (isins: string[], earliestDates: ReadonlyMap<string, IsoDate>) => Promise<PriceMap>,
  lookBackDays = LOOK_BACK_DAYS,
  canSave: () => boolean = () => true,
  dailyBackfill = false,
): Promise<{ updated: number; problems: string[]; unavailable: boolean; noMarketFile: boolean }> {
  const amfi = linked.filter((a) => a.feed === 'amfi');
  const nse = linked.filter((a) => a.feed === 'nse');
  const earliestDates = new Map(
    amfi.flatMap((asset) => asset.navStartDate ? [[asset.isin, asset.navStartDate] as const] : []),
  );
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
    amfi.length ? funds(amfi.map((a) => a.isin), earliestDates) : none,
    listedRequest,
  ]);
  const problems: string[] = [];
  let unavailable = false;
  const fundResult = got[0]!;
  let fundRows: ReturnType<typeof pricesFor> = [];
  if (amfi.length && fundResult.status === 'rejected') {
    if (!(fundResult.reason instanceof FeedError)) throw fundResult.reason;
    problems.push(fundResult.reason.message);
    unavailable = true;
  } else if (amfi.length && fundResult.status === 'fulfilled') {
    fundRows = pricesFor(amfi, fundResult.value);
    const missing = amfi.length - fundRows.length;
    if (missing && !(lookBackDays === 1 && fundResult.value.size === 0)) {
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
      if (!(error instanceof FeedError)) throw error;
      problems.push(error.message);
      unavailable = true;
    }
  }
  const nseRows = pricesFor(nse, nseMap);
  const bseRows = pricesFor(missingNse, bseMap);
  const listedRows = nseRows.concat(bseRows);
  const missing = nse.length - listedRows.length;
  if (missing && nseResult.status === 'rejected') {
    problems.push(nseResult.reason.message);
    unavailable = true;
  } else if (missing && !unavailable && !noMarketFile) {
    if (dailyBackfill && marketFileFound) {
      problems.push(
        `No exchange price was found for ${missing === 1 ? '1 investment' : `${missing} investments`}. Check the ISIN.`,
      );
    } else if (nseMap.size === 0 && bseMap.size === 0) {
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
      problems,
    });
  }
  return {
    updated: rows.length && canSave() ? applyFeedPrices(db, rows) : 0,
    problems,
    unavailable,
    noMarketFile,
  };
}
