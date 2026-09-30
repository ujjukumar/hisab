import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyFeedPrices } from '@/lib/actions/applyPrices';
import { openDatabase, type Connection } from '@/lib/db/connect';
import { assets, prices } from '@/lib/db/schema';

/** PLAN section 11, phase 8, on a seeded database. */

const dir = mkdtempSync(join(tmpdir(), 'hisaab-prices-'));
let conn: Connection;
let assetId: number;

beforeAll(() => {
  const seeded = spawnSync(process.execPath, ['scripts/seed.ts'], {
    env: { ...process.env, DATABASE_PATH: join(dir, 'live.db') },
    encoding: 'utf8',
  });
  if (seeded.status !== 0) throw new Error(`Seed failed: ${seeded.stderr}`);
  process.env.DATABASE_PATH = join(dir, 'live.db');
  conn = openDatabase({ migrate: false });
  assetId = conn.db
    .select()
    .from(assets)
    .where(eq(assets.name, 'Meridian Flexi Cap Direct-G'))
    .get()!.id;
});

afterAll(() => {
  conn.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const priceOn = (date: string) =>
  conn.db
    .select()
    .from(prices)
    .where(and(eq(prices.assetId, assetId), eq(prices.date, date)))
    .get();

describe('applyFeedPrices', () => {
  it('adds a price for a new day, marked automatic', () => {
    expect(applyFeedPrices(conn.db, [{ assetId, date: '2030-01-02', price: '101.5' }])).toBe(1);
    expect(priceOn('2030-01-02')).toMatchObject({ price: '101.5', source: 'auto' });
  });

  it('replaces an earlier automatic price for the same day', () => {
    expect(applyFeedPrices(conn.db, [{ assetId, date: '2030-01-02', price: '102' }])).toBe(1);
    expect(priceOn('2030-01-02')).toMatchObject({ price: '102', source: 'auto' });
  });

  it('never replaces a price the owner entered or imported', () => {
    for (const source of ['manual', 'import'] as const) {
      const date = source === 'manual' ? '2030-02-03' : '2030-02-04';
      conn.db.insert(prices).values({ assetId, date, price: '99', source }).run();
      expect(applyFeedPrices(conn.db, [{ assetId, date, price: '120' }])).toBe(0);
      expect(priceOn(date)).toMatchObject({ price: '99', source });
    }
  });

  it('writes nothing if one row fails', () => {
    expect(() =>
      applyFeedPrices(conn.db, [
        { assetId, date: '2030-03-01', price: '1' },
        { assetId: 999999, date: '2030-03-01', price: '1' },
      ]),
    ).toThrow();
    expect(priceOn('2030-03-01')).toBeUndefined();
  });
});
