import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@/lib/db/connect';
import { accounts, assets, categories, investmentTransactions, transactions } from '@/lib/db/schema';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ get db() { return connection.db; } }));

const folder = mkdtempSync(join(tmpdir(), 'hisaab-tax-'));
const previousPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(folder, 'invented.db');
const connection = openDatabase();

afterAll(() => {
  connection.sqlite.close();
  if (previousPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousPath;
  rmSync(folder, { recursive: true, force: true });
});

const r = (rupees: number) => rupees * 100;

function seed() {
  const { db } = connection;
  const accountId = db
    .insert(accounts)
    .values({ name: 'Invented bank', type: 'bank', openingDate: '2023-04-01' })
    .returning()
    .get().id;
  const category = (name: string) =>
    db.select().from(categories).all().find((c) => c.name === name && c.kind === 'income')!.id;
  const asset = (name: string, type: 'stock' | 'fixed_deposit' | 'ppf', valuation: 'units' | 'fd' | 'manual') =>
    db
      .insert(assets)
      .values({ name, type, valuation, assetClass: type === 'stock' ? 'equity' : 'debt' })
      .returning()
      .get().id;
  const txn = (
    assetId: number,
    date: string,
    action: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'interest' | 'dividend',
    amount: number,
    units?: string,
  ) =>
    db
      .insert(investmentTransactions)
      .values({ assetId, date, action, amount: r(amount), units: units ?? null, price: units ? '1' : null })
      .returning()
      .get().id;

  const steel = asset('Invented Steel Ltd', 'stock', 'units');
  txn(steel, '2023-05-10', 'buy', 1000, '10');
  txn(steel, '2024-08-01', 'sell', 1500, '10');
  const dividend = txn(steel, '2024-07-01', 'dividend', 50);
  db.insert(transactions)
    .values({ date: '2024-07-01', type: 'income', amount: r(50), accountId, categoryId: category('Dividends'), description: 'Dividend', investmentTxnId: dividend })
    .run();

  const fd = asset('Invented FD', 'fixed_deposit', 'fd');
  txn(fd, '2023-06-01', 'deposit', 10_000);
  txn(fd, '2024-12-01', 'withdrawal', 10_700);

  const ppf = asset('Invented PPF', 'ppf', 'manual');
  txn(ppf, '2024-06-01', 'interest', 5_000);

  for (const [date, amount] of [['2024-09-30', 300], ['2025-04-01', 999]] as const) {
    db.insert(transactions)
      .values({ date, type: 'income', amount: r(amount), accountId, categoryId: category('Interest'), description: 'Savings interest' })
      .run();
  }

  const oversold = asset('Invented Oversold Ltd', 'stock', 'units');
  txn(oversold, '2024-10-01', 'sell', 100, '5');
}

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe('tax report and saved figures', () => {
  it('works the year from records and the saved figures', async () => {
    seed();
    const { saveTaxYear } = await import('@/lib/actions/tax');
    const { taxReport } = await import('@/lib/queries/tax');

    const empty = taxReport({ year: '2024' });
    expect(empty.figures).toBeNull();
    // FD excess and unlinked Money interest count; PPF interest and next year's don't.
    expect(empty.interest).toMatchObject({ worked: r(1_000), used: r(1_000) });
    // The linked Money row isn't counted twice.
    expect(empty.dividends).toMatchObject({ worked: r(50), used: r(50) });
    expect(empty.gains).toHaveLength(1);
    expect(empty.gains[0]).toMatchObject({ assetName: 'Invented Steel Ltd', kind: 'equity_long', gain: r(500) });
    expect(empty.problems).toEqual([
      expect.stringContaining('Invented Oversold Ltd: the sale on 1 Oct 2024 sells more units'),
    ]);

    expect((await saveTaxYear(form({ year: '2024', grossSalary: '-1' }))).ok).toBe(false);
    expect(await saveTaxYear(form({ year: '2024', grossSalary: '10,00,000', salaryTds: '50000' })))
      .toEqual({ ok: true });
    expect(await saveTaxYear(form({ year: '2024', grossSalary: '10,00,000', salaryTds: '50000', interestOverride: '1200' })))
      .toEqual({ ok: true });

    const report = taxReport({ year: '2024' });
    expect(report.figures).toMatchObject({ grossSalary: r(1_000_000), salaryTds: r(50_000), interestOverride: r(1_200), dividendOverride: null });
    expect(report.interest).toMatchObject({ worked: r(1_000), used: r(1_200) });
    expect(report.computation).toMatchObject({
      slabIncome: r(926_250),
      slabTax: r(42_625),
      specialTax: 0,
      rebate: 0,
      relief: 0,
      cess: r(1_705),
      totalTax: r(44_330),
      balance: r(-5_670),
    });
  });

  it('leaves the tax out for a year without rules', async () => {
    const { taxReport } = await import('@/lib/queries/tax');
    const latest = taxReport({}).years[0]!.value;
    const report = taxReport({ year: String(latest) });
    if (report.rules === null) expect(report.computation).toBeNull();
    expect(taxReport({ year: '1999' }).year).toBe(latest);
  });
});
