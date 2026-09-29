import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/lib/db/connect';
import { assets, investmentTransactions, prices, valuations } from '@/lib/db/schema';
import { buildPortfolio, totals, type HoldingRow } from '@/lib/domain/portfolio';

/**
 * PLAN section 11, phase 4: the seeded portfolio matches a hand-checked spreadsheet.
 * tests/fixtures/portfolio-check.csv was worked out from the seed's units, buy amounts
 * and prices (value = units × price; FD = principal × (1 + r/4)^(4t)); all data is invented.
 */

const DATE = '2026-09-28'; // the seed's "today"
const dir = mkdtempSync(join(tmpdir(), 'hisaab-check-'));
let conn: Connection;
let rows: HoldingRow[];

const rupees = (s: string | undefined) => (s ? Math.round(Number(s) * 100) : null);

function readFixture() {
  const lines = readFileSync(join(__dirname, 'fixtures/portfolio-check.csv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1);
  return lines.map((line) => {
    // Only the name can be quoted, and it never contains a quote.
    const quoted = line.match(/^"([^"]*)",(.*)$/);
    const [name, ...rest] = quoted ? [quoted[1]!, ...quoted[2]!.split(',')] : line.split(',');
    const [units, price, value, cost, totalReturn, change] = rest;
    return {
      name,
      units: units || null,
      price: price || null,
      value: rupees(value),
      cost: rupees(cost),
      totalReturn: rupees(totalReturn),
      change: rupees(change),
    };
  });
}

beforeAll(() => {
  const seeded = spawnSync(process.execPath, ['scripts/seed.ts'], {
    env: { ...process.env, DATABASE_PATH: join(dir, 'check.db') },
    encoding: 'utf8',
  });
  if (seeded.status !== 0) throw new Error(`Seed failed: ${seeded.stderr}`);

  process.env.DATABASE_PATH = join(dir, 'check.db');
  conn = openDatabase({ migrate: false });
  const { db } = conn;
  rows = buildPortfolio(
    {
      assets: db.select().from(assets).all(),
      txns: db
        .select({
          id: investmentTransactions.id,
          assetId: investmentTransactions.assetId,
          date: investmentTransactions.date,
          action: investmentTransactions.action,
          units: investmentTransactions.units,
          price: investmentTransactions.price,
          amount: investmentTransactions.amount,
          fees: investmentTransactions.fees,
          splitFrom: investmentTransactions.splitFrom,
          splitTo: investmentTransactions.splitTo,
        })
        .from(investmentTransactions)
        .all(),
      prices: db
        .select({ assetId: prices.assetId, date: prices.date, price: prices.price })
        .from(prices)
        .all(),
      valuations: db
        .select({ assetId: valuations.assetId, date: valuations.date, value: valuations.value })
        .from(valuations)
        .all(),
    },
    DATE,
  );
}, 60_000);

afterAll(() => {
  conn?.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('seeded portfolio against tests/fixtures/portfolio-check.csv', () => {
  const expected = readFixture();
  const holdings = expected.filter((e) => e.name !== 'Total');

  it('has every holding and nothing else', () => {
    expect(rows.map((r) => r.asset.name).sort()).toEqual(holdings.map((e) => e.name).sort());
  });

  it.each(holdings.map((e) => [e.name, e] as const))('%s', (name, e) => {
    const r = rows.find((row) => row.asset.name === name)!;
    expect({
      units: r.asset.valuation === 'units' ? r.holding.units.toString() : null,
      price: r.price ? String(Number(r.price.price)) : null,
      value: r.value,
      cost: r.holding.cost,
      totalReturn: r.totalReturn,
      change: r.sinceLast?.change ?? null,
    }).toEqual({
      units: e.units,
      price: e.price,
      value: e.value,
      cost: e.cost,
      totalReturn: e.totalReturn,
      change: e.change,
    });
  });

  it('totals', () => {
    const total = expected.find((e) => e.name === 'Total')!;
    const t = totals(rows, DATE);
    expect(t.value).toBe(total.value);
    expect(t.invested).toBe(total.cost);
    expect(t.totalReturn).toBe(total.totalReturn);
    expect(t.change?.amount).toBe(total.change);
    // Nothing has been sold, so all-time returns are the total return plus the ₹640 dividend.
    expect(t.allTime).toBe(total.totalReturn! + 64_000);
  });
});
