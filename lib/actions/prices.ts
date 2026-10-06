'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fetchAndSave } from '@/lib/actions/priceDownloads';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { isValidDate, today, type IsoDate } from '@/lib/domain/dates';
import {
  feedAssets,
  isDue,
  LOOK_BACK_DAYS,
  pastPriceNeeds,
} from '@/lib/domain/priceFeeds';
import { amfiFor, amfiLatest } from '@/lib/feeds';
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

const investmentIds = z.array(z.number().int().positive()).min(1).max(500);

export async function fetchInvestmentPrices(ids: number[]): Promise<PriceResult> {
  const parsed = investmentIds.safeParse(ids);
  if (!parsed.success) return invalid(parsed.error);
  const selected = new Set(parsed.data);
  const held = new Set(
    portfolio()
      .filter((row) => !row.sold && selected.has(row.asset.id))
      .map((row) => row.asset.id),
  );
  const linked = feedAssets(portfolioData().assets).filter((asset) => held.has(asset.id));
  if (!linked.length) return failed('Add a valid ISIN to this investment to fetch its price.');

  const { updated, problems } = await fetchAndSave(linked, today(), () => amfiLatest());
  revalidate();
  if (problems.length) return failed(problems.join(' '));
  return updated
    ? { ok: true, updated }
    : failed('No new prices were found. Try again after the market closes.');
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
 * Fill one daily or weekly target for older Settings clients. The background job now owns
 * the scheduled loop and progress; a date already filled is skipped.
 */
export async function fetchPastPrices(date: string): Promise<PriceResult> {
  const parsed = pastSchema.safeParse(date);
  if (!parsed.success) return invalid(parsed.error);
  const day = parsed.data as IsoDate;
  const need = pastPriceNeeds(portfolioData(), today()).find((n) => n.date === day);
  if (!need) return { ok: true, updated: 0 };
  const lookBackDays = need.cadence === 'daily' ? 1 : LOOK_BACK_DAYS;
  const { updated, problems } = await fetchAndSave(
    need.linked,
    day,
    (isins, earliestDates) => amfiFor(day, isins, lookBackDays, earliestDates),
    lookBackDays,
  );
  revalidate();
  return problems.length ? failed(problems.join(' ')) : { ok: true, updated };
}
