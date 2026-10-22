'use server';

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { addDays, today } from '@/lib/domain/dates';
import { settings } from '@/lib/db/schema';
import {
  ABSENT_PRICES_SETTING,
  NO_MARKET_FILE_DATES_SETTING,
  PUBLISH_GRACE_DAYS,
  absentPriceKey,
  benchmarkWorkKey,
  pendingPriceNeeds,
  priceWorkKey,
} from '@/lib/domain/priceFeeds';
import { amfiOn } from '@/lib/feeds';
import { freshPortfolioData, priceGaps } from '@/lib/queries/investments';
import { failed, type ActionFailure } from '@/lib/validation/money';
import { benchmarkHistory, benchmarkList } from '@/lib/queries/benchmarks';
import { fetchAndSave } from './priceDownloads';
import {
  claimPriceJob,
  readPriceJob,
  writePriceJob,
  type PriceJob,
  type PriceJobStatus,
} from './priceJobStore';

const worker = globalThis as typeof globalThis & {
  hisaabPriceWorker?: { id: string; active: boolean };
};
worker.hisaabPriceWorker ??= { id: randomUUID(), active: false };
const DEBUG_FEEDS = process.env.NODE_ENV === 'development' || process.env.HISAAB_PRICE_DEBUG === '1';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function current(id: string, owner: string): PriceJob | null {
  const job = readPriceJob(db);
  return job?.id === id && job.owner === owner ? job : null;
}

async function runJob(id: string, owner: string): Promise<void> {
  const heartbeat = setInterval(() => {
    const job = current(id, owner);
    if (job?.state === 'running')
      writePriceJob(db, { ...job, heartbeat: new Date().toISOString() });
  }, 10_000);
  try {
    while (true) {
      const job = current(id, owner);
      if (!job) return;
      if (job.state !== 'running') {
        if (job.state === 'stopping') writePriceJob(db, { ...job, state: 'stopped', date: null });
        return;
      }
      const asOf = today();
      const benchmarks = benchmarkList();
      const needs = pendingPriceNeeds(
        freshPortfolioData(),
        asOf,
        new Set(job.attempted),
        priceGaps(),
        benchmarks,
        benchmarkHistory(benchmarks.map((item) => item.id)),
      );
      const need = needs[0];
      if (!need) {
        const skipped = job.failedDates ?? 0;
        writePriceJob(db, {
          ...job,
          state: 'done',
          date: null,
          total: job.done,
          owner: null,
          pid: null,
          message: skipped
            ? `${skipped === 1 ? '1 date' : `${skipped} dates`} couldn't be fetched. Retry missing prices to try again. ${job.message}`
            : '',
        });
        return;
      }
      writePriceJob(db, {
        ...job,
        date: need.date,
        total: Math.max(job.total, job.done + needs.length),
      });
      // One whole-market AMFI file per date; its size tells a published file from a missing one.
      const result = await fetchAndSave(
        need.linked,
        need.date,
        () => amfiOn(need.date),
        1,
        () => current(id, owner)?.state === 'running',
        true,
        need.benchmarks,
      );
      const latest = current(id, owner);
      if (!latest) return;
      if (latest.state !== 'running') continue;
      if (result.noMarketFile && need.date <= addDays(asOf, -PUBLISH_GRACE_DAYS))
        addToListSetting(NO_MARKET_FILE_DATES_SETTING, [need.date]);
      if (result.absent.length)
        addToListSetting(ABSENT_PRICES_SETTING, result.absent.map((assetId) => absentPriceKey(assetId, need.date)));
      if (result.unreachable) {
        writePriceJob(db, {
          ...latest,
          state: 'failed',
          date: null,
          updated: latest.updated + result.updated,
          message: result.problems.join(' '),
        });
        return;
      }
      // A date that failed is left for the next run; the rest of this run carries on.
      writePriceJob(db, {
        ...latest,
        attempted: [
          ...latest.attempted,
          ...need.linked.map((asset) => priceWorkKey(need, asset.id)),
          ...(need.benchmarks ?? []).map((item) => benchmarkWorkKey(need, item.id)),
        ],
        done: latest.done + 1,
        updated: latest.updated + result.updated,
        failedDates: result.unavailable ? (latest.failedDates ?? 0) + 1 : latest.failedDates,
        message: result.problems.length ? result.problems.join(' ') : latest.message,
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

function addToListSetting(key: string, items: string[]): void {
  db.transaction((tx) => {
    const row = tx.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
    let current: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row?.value ?? '[]');
      if (Array.isArray(parsed)) current = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      // A damaged list is rebuilt from this run.
    }
    const value = JSON.stringify([...new Set([...current, ...items])].sort());
    tx.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString() } })
      .run();
  });
}

function kickJob(): void {
  const local = worker.hisaabPriceWorker!;
  if (local.active) return;
  const job = claimPriceJob(db, local.id, process.pid, new Date().toISOString(), isAlive);
  if (!job) return;
  local.active = true;
  setImmediate(() => {
    void runJob(job.id, local.id)
      .catch((error: unknown) => {
        if (DEBUG_FEEDS) console.error('[price-backfill] worker failed', error);
        const latest = current(job.id, local.id);
        if (latest?.state === 'running') {
          writePriceJob(db, {
            ...latest,
            state: 'failed',
            date: null,
            message: "Past prices couldn't be saved. Try again.",
          });
        }
      })
      .finally(() => {
        local.active = false;
      });
  });
}

export async function priceJobStatus(): Promise<PriceJobStatus | null> {
  kickJob();
  const job = readPriceJob(db);
  if (!job) return null;
  return {
    state: job.state,
    done: job.done,
    total: job.total,
    date: job.date,
    updated: job.updated,
    message: job.message,
  };
}

export async function startPriceJob(): Promise<PriceJobStatus | null> {
  db.transaction((tx) => {
    const previous = readPriceJob(tx);
    if (previous?.state === 'running' || previous?.state === 'stopping') return;
    writePriceJob(tx, {
      id: randomUUID(),
      state: 'running',
      attempted: [],
      done: 0,
      total: 0,
      date: null,
      updated: 0,
      message: '',
      owner: null,
      pid: null,
      heartbeat: new Date().toISOString(),
    });
  });
  return priceJobStatus();
}

export async function stopPriceJob(): Promise<PriceJobStatus | null> {
  db.transaction((tx) => {
    const job = readPriceJob(tx);
    if (job?.state === 'running') writePriceJob(tx, { ...job, state: 'stopping' });
  });
  revalidatePath('/settings');
  return priceJobStatus();
}

/** Forget prices recorded as not published, so the next run looks for them again. */
export async function recheckMissingPrices(): Promise<{ ok: true } | ActionFailure> {
  const job = readPriceJob(db);
  if (job?.state === 'running' || job?.state === 'stopping')
    return failed('Wait for past prices to finish, then check again.');
  db.transaction((tx) => {
    tx.delete(settings).where(eq(settings.key, ABSENT_PRICES_SETTING)).run();
  });
  revalidatePath('/settings');
  return { ok: true };
}
