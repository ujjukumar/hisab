import { applyFeedPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import { LOOK_BACK_DAYS, pricesFor, type FeedAsset, type PriceMap } from '@/lib/domain/priceFeeds';
import type { IsoDate } from '@/lib/domain/dates';
import { FeedError, bseLatest, nseLatest } from '@/lib/feeds';

export async function fetchAndSave(
  linked: FeedAsset[],
  date: IsoDate,
  funds: (isins: string[]) => Promise<PriceMap>,
  lookBackDays = LOOK_BACK_DAYS,
  canSave: () => boolean = () => true,
): Promise<{ updated: number; problems: string[]; unavailable: boolean }> {
  const amfi = linked.filter((a) => a.feed === 'amfi');
  const nse = linked.filter((a) => a.feed === 'nse');
  const none: PriceMap = new Map();
  const got = await Promise.allSettled([
    amfi.length ? funds(amfi.map((a) => a.isin)) : none,
    nse.length ? nseLatest(date, lookBackDays) : none,
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
  if (missingNse.length) {
    try {
      bseMap = await bseLatest(date, lookBackDays);
    } catch (error) {
      if (!(error instanceof FeedError)) throw error;
      problems.push(error.message);
      unavailable = true;
    }
  }
  const listedRows = pricesFor(nse, nseMap).concat(pricesFor(missingNse, bseMap));
  const missing = nse.length - listedRows.length;
  if (missing && nseResult.status === 'rejected') {
    problems.push(nseResult.reason.message);
    unavailable = true;
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
  return {
    updated: rows.length && canSave() ? applyFeedPrices(db, rows) : 0,
    problems,
    unavailable,
  };
}
