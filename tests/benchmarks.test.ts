import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@/lib/db/connect';
import { benchmarkPrices, benchmarks } from '@/lib/db/schema';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ get db() { return connection.db; } }));

const folder = mkdtempSync(join(tmpdir(), 'hisaab-benchmarks-'));
const previousPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(folder, 'invented.db');
const connection = openDatabase();

afterAll(() => {
  connection.sqlite.close();
  if (previousPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousPath;
  rmSync(folder, { recursive: true, force: true });
});

describe('benchmark settings', () => {
  it('validates, normalises and removes a benchmark with its prices', async () => {
    const { addBenchmark, removeBenchmark } = await import('@/lib/actions/benchmarks');
    const form = (name: string, isin: string) => {
      const data = new FormData();
      data.set('name', name);
      data.set('isin', isin);
      return data;
    };
    expect((await addBenchmark(form('Index', 'NOT-A-FUND'))).ok).toBe(false);
    expect(await addBenchmark(form('Invented index fund', 'inf000bm0011'))).toEqual({ ok: true });
    expect((await addBenchmark(form('Duplicate', 'INF000BM0011'))).ok).toBe(false);
    const saved = connection.db.select().from(benchmarks).get()!;
    expect(saved.isin).toBe('INF000BM0011');
    connection.db.insert(benchmarkPrices).values({ benchmarkId: saved.id,
      date: '2026-01-02', price: '10' }).run();
    const remove = new FormData();
    remove.set('id', String(saved.id));
    expect(await removeBenchmark(remove)).toEqual({ ok: true });
    expect(connection.db.select().from(benchmarks).all()).toEqual([]);
    expect(connection.db.select().from(benchmarkPrices).all()).toEqual([]);
  });

  it('accepts every suggested index fund as a benchmark', async () => {
    const { addBenchmark } = await import('@/lib/actions/benchmarks');
    const { SUGGESTED_BENCHMARKS } = await import('@/lib/domain/benchmarks');
    expect(new Set(SUGGESTED_BENCHMARKS.map((item) => item.isin)).size).toBe(SUGGESTED_BENCHMARKS.length);
    for (const { name, isin } of SUGGESTED_BENCHMARKS) {
      const data = new FormData();
      data.set('name', name);
      data.set('isin', isin);
      expect(await addBenchmark(data)).toEqual({ ok: true });
    }
    expect(connection.db.select().from(benchmarks).all().map((row) => row.isin))
      .toEqual(SUGGESTED_BENCHMARKS.map((item) => item.isin));
  });
});