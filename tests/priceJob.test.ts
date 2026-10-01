import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claimPriceJob, readPriceJob, writePriceJob } from '@/lib/actions/priceJobStore';
import { openDatabase } from '@/lib/db/connect';

const folder = mkdtempSync(join(tmpdir(), 'hisaab-price-job-'));
const priorPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(folder, 'invented.db');
const connection = openDatabase();

afterAll(() => {
  connection.sqlite.close();
  if (priorPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = priorPath;
  rmSync(folder, { recursive: true, force: true });
});

const time = '2024-04-02T12:00:00.000Z';

describe('price job checkpoint', () => {
  it('claims an unowned run once and preserves attempts through a second connection', () => {
    writePriceJob(connection.db, {
      id: 'invented-run',
      state: 'running',
      attempted: ['2024-04-01:daily:1'],
      done: 1,
      total: 3,
      date: '2024-04-02',
      updated: 1,
      message: '',
      owner: null,
      pid: null,
      heartbeat: time,
    });
    const claimed = claimPriceJob(connection.db, 'first-worker', 10, time, () => true);
    expect(claimed?.attempted).toEqual(['2024-04-01:daily:1']);
    expect(claimPriceJob(connection.db, 'second-worker', 20, time, () => true)).toBeNull();
    const reopened = openDatabase({ migrate: false });
    try {
      expect(readPriceJob(reopened.db)?.owner).toBe('first-worker');
    } finally {
      reopened.sqlite.close();
    }
  });

  it('reclaims after a dead worker and stops a queued request after restart', () => {
    const resumed = claimPriceJob(connection.db, 'second-worker', 20, time, () => false);
    expect(resumed?.done).toBe(1);
    writePriceJob(connection.db, { ...resumed!, state: 'stopping' });
    expect(claimPriceJob(connection.db, 'third-worker', 30, time, () => false)).toBeNull();
    expect(readPriceJob(connection.db)?.state).toBe('stopped');
  });
});
