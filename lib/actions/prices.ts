'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyFeedPrices } from '@/lib/actions/applyPrices';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { addMonths, currentMonth, isValidDate, today, type IsoDate } from '@/lib/domain/dates';
import {
  feedAssets,
  isDue,
  pastPriceNeeds,
  pricesFor,
  type FeedAsset,
  type PriceMap,
} from '@/lib/domain/priceFeeds';
import { FeedError, amfiFor, amfiLatest, nseLatest } from '@/lib/feeds';
import { portfolio, portfolioData } from '@/lib/queries/investments';
import { autoPrices, priceUpdate, type PriceUpdate } from '@/lib/queries/settings';
import { failed, invalid, type ActionFailure } from '@/lib/validation/money';

export type PriceResult = { ok: true; updated: number } | ActionFailure;

function revalidate() {
  revalidatePath('/investments', 'layout');
  revalidatePath('/money', 'layout');
  revalidatePath('/settings');
  revalidatePath('/');
}

function saveSetting(key: string, value: string) {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
}

/**
 * Download the files `linked` needs, save their prices and collect what went wrong.
 * One source failing doesn't stop the other.
 */
async function fetchAndSave(
  linked: FeedAsset[],
  date: IsoDate,
  funds: (isins: string[]) => Promise<PriceMap>,
): Promise<{ updated: number; problems: string[] }> {
  const amfi = linked.filter((a) => a.feed === 'amfi');
  const nse = linked.filter((a) => a.feed === 'nse');
  const none: PriceMap = new Map();
  const got = await Promise.allSettled([
    amfi.length ? funds(amfi.map((a) => a.isin)) : none,
    nse.length ? nseLatest(date) : none,
  ]);
  const problems: string[] = [];
  const rows = [amfi, nse].flatMap((group, i) => {
    const result = got[i];
    if (!result || group.length === 0) return [];
    if (result.status === 'rejected') {
      if (!(result.reason instanceof FeedError)) throw result.reason;
      problems.push(result.reason.message);
      return [];
    }
    const found = pricesFor(group, result.value);
    const lacking = group.length - found.length;
    if (lacking > 0) {
      const source = i === 0 ? 'AMFI' : 'NSE';
      problems.push(
        `${source} had no price for ${lacking === 1 ? '1 investment' : `${lacking} investments`}. Check the ISIN in each one.`,
      );
    }
    return found;
  });
  return { updated: rows.length ? applyFeedPrices(db, rows) : 0, problems };
}

// Two tabs opening at once share one download instead of fetching twice.
let running: Promise<PriceResult> | null = null;

async function update(): Promise<PriceResult> {
  const held = new Set(
    portfolio()
      .filter((r) => !r.sold)
      .map((r) => r.asset.id),
  );
  const linked = feedAssets(portfolioData().assets).filter((a) => held.has(a.id));
  const date = today();
  const { updated, problems } = linked.length
    ? await fetchAndSave(linked, date, () => amfiLatest())
    : {
        updated: 0,
        problems: ['No investments have an ISIN to update. Add one in each investment.'],
      };
  const status: PriceUpdate = {
    on: date,
    at: new Date().toISOString(),
    ok: problems.length === 0,
    updated,
    message: problems.join(' '),
  };
  saveSetting('price_update', JSON.stringify(status));
  revalidate();
  return status.ok ? { ok: true, updated } : failed(status.message);
}

/**
 * Update prices from AMFI and NSE. On open (`force` false) this runs at most once a day and
 * only when automatic prices are on; "Update now" forces it. Returns null when it was skipped.
 * ponytail: a failed check still counts for the day, so being offline doesn't retry on every
 * open; the owner can press "Update now". Retry after an hour if that proves annoying.
 */
export async function refreshPrices(force: boolean): Promise<PriceResult | null> {
  const parsed = z.boolean().safeParse(force);
  if (!parsed.success) return invalid(parsed.error);
  if (!parsed.data) {
    const [auto, last] = await Promise.all([autoPrices(), priceUpdate()]);
    if (!auto || !isDue(last?.on ?? null, today())) return null;
  }
  running ??= update().finally(() => {
    running = null;
  });
  return running;
}

export async function setAutoPrices(on: boolean): Promise<PriceResult> {
  const parsed = z.boolean().safeParse(on);
  if (!parsed.success) return invalid(parsed.error);
  saveSetting('auto_prices', String(parsed.data));
  revalidate();
  return { ok: true, updated: 0 };
}

const pastSchema = z.string().refine(isValidDate, 'Choose a valid date.');

/**
 * Fill in one month-end's prices for "Fetch past prices". The page calls this once per
 * month-end so the owner sees progress and can stop; a month already filled is skipped.
 * ponytail: an ISIN AMFI or NSE never lists (a merged fund) keeps its month on the list.
 */
export async function fetchPastPrices(date: string): Promise<PriceResult> {
  const parsed = pastSchema.safeParse(date);
  if (!parsed.success) return invalid(parsed.error);
  const day = parsed.data as IsoDate;
  const need = pastPriceNeeds(portfolioData(), addMonths(currentMonth(), -1)).find(
    (n) => n.date === day,
  );
  if (!need) return { ok: true, updated: 0 };
  const { updated, problems } = await fetchAndSave(need.linked, day, (isins) =>
    amfiFor(day, isins),
  );
  revalidate();
  return problems.length ? failed(problems.join(' ')) : { ok: true, updated };
}
