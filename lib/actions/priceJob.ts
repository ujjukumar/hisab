'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { today } from '@/lib/domain/dates';
import { pendingPriceNeeds, priceWorkKey } from '@/lib/domain/priceFeeds';
import { amfiFor } from '@/lib/feeds';
import { freshPortfolioData } from '@/lib/queries/investments';
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
      const needs = pendingPriceNeeds(freshPortfolioData(), today(), new Set(job.attempted));
      const need = needs[0];
      if (!need) {
        writePriceJob(db, {
          ...job,
          state: 'done',
          date: null,
          total: job.done,
          owner: null,
          pid: null,
        });
        return;
      }
      writePriceJob(db, {
        ...job,
        date: need.date,
        total: Math.max(job.total, job.done + needs.length),
      });
      const lookBack = need.cadence === 'daily' ? 1 : 7;
      const result = await fetchAndSave(
        need.linked,
        need.date,
        (isins) => amfiFor(need.date, isins, lookBack),
        lookBack,
        () => current(id, owner)?.state === 'running',
      );
      const latest = current(id, owner);
      if (!latest) return;
      if (latest.state !== 'running') continue;
      const message = result.problems.join(' ');
      if (result.unavailable) {
        writePriceJob(db, {
          ...latest,
          state: 'failed',
          date: null,
          updated: latest.updated + result.updated,
          message,
        });
        return;
      }
      writePriceJob(db, {
        ...latest,
        attempted: [
          ...latest.attempted,
          ...need.linked.map((asset) => priceWorkKey(need, asset.id)),
        ],
        done: latest.done + 1,
        updated: latest.updated + result.updated,
        message: message || latest.message,
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

function kickJob(): void {
  const local = worker.hisaabPriceWorker!;
  if (local.active) return;
  const job = claimPriceJob(db, local.id, process.pid, new Date().toISOString(), isAlive);
  if (!job) return;
  local.active = true;
  setImmediate(() => {
    void runJob(job.id, local.id)
      .catch(() => {
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
