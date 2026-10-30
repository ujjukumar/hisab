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
  it('validates, adds and removes a benchmark with its prices', async () => {
    const { addBenchmark, removeBenchmark } = await import('@/lib/actions/benchmarks');
    expect((await addBenchmark(form('not-an-index'))).ok).toBe(false);
    expect(await addBenchmark(form('sp500'))).toEqual({ ok: true });
    expect((await addBenchmark(form('sp500'))).ok).toBe(false);
    const saved = connection.db.select().from(benchmarks).get()!;
    expect(saved).toMatchObject({ code: 'sp500', name: 'S&P 500' });
    connection.db.insert(benchmarkPrices).values({ benchmarkId: saved.id,
      date: '2026-01-02', price: '10' }).run();
    const remove = new FormData();
    remove.set('id', String(saved.id));
    expect(await removeBenchmark(remove)).toEqual({ ok: true });
    expect(connection.db.select().from(benchmarks).all()).toEqual([]);
    expect(connection.db.select().from(benchmarkPrices).all()).toEqual([]);
  });

  it('accepts listed indices up to the limit', async () => {
    const { addBenchmark } = await import('@/lib/actions/benchmarks');
    const { BENCHMARK_INDICES, MAX_BENCHMARKS } = await import('@/lib/domain/benchmarks');
    expect(new Set(BENCHMARK_INDICES.map((item) => item.code)).size).toBe(BENCHMARK_INDICES.length);
    expect(new Set(BENCHMARK_INDICES.map((item) => item.symbol)).size).toBe(BENCHMARK_INDICES.length);
    const allowed = BENCHMARK_INDICES.slice(0, MAX_BENCHMARKS);
    for (const { code } of allowed) expect(await addBenchmark(form(code))).toEqual({ ok: true });
    expect((await addBenchmark(form(BENCHMARK_INDICES[MAX_BENCHMARKS]!.code))).ok).toBe(false);
    expect(connection.db.select().from(benchmarks).all().map((row) => row.code))
      .toEqual(allowed.map((item) => item.code));
  });
});

function form(code: string) {
  const data = new FormData();
  data.set('code', code);
  return data;
}