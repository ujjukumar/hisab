import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTHING_NEW, applyImport } from '@/lib/actions/applyImport';
import { openDatabase, type Connection } from '@/lib/db/connect';
import { accounts, assets, investmentTransactions, prices, transactions } from '@/lib/db/schema';
import { moneyMoved } from '@/lib/domain/holdings';
import { parseValueResearch } from '@/lib/domain/valueResearch';
import { planImport } from '@/lib/queries/imports';
import type { Cell } from '@/lib/xls';

/** PLAN section 11, phase 7, on a seeded database. Every name, number and ISIN is invented. */

const dir = mkdtempSync(join(tmpdir(), 'hisaab-import-'));
let conn: Connection;

beforeAll(() => {
  const seeded = spawnSync(process.execPath, ['scripts/seed.ts'], {
    env: { ...process.env, DATABASE_PATH: join(dir, 'live.db') },
    encoding: 'utf8',
  });
  if (seeded.status !== 0) throw new Error(`Seed failed: ${seeded.stderr}`);
  process.env.DATABASE_PATH = join(dir, 'live.db');
  conn = openDatabase({ migrate: false });
});

afterAll(() => {
  conn.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NONE = { match: {}, assetClass: {} };

/** A Value Research funds sheet, newest row first, with its total. */
function vrFile(
  rows: [
    date: string,
    name: string,
    type: string,
    amount: number,
    units: number,
    nav: number,
    isin: string,
  ][],
) {
  const total = rows.reduce((s, r) => s + Math.round(r[3] * 100), 0) / 100;
  const body: Cell[][] = rows.map(([date, name, type, amount, units, nav, isin]) => [
    date,
    name,
    'F-1',
    type,
    amount,
    units,
    nav,
    '--',
    '--',
    isin,
  ]);
  return parseValueResearch([
    {
      name: 'Mutual Funds & SIFs',
      rows: [
        [
          'Transaction Date',
          'Scheme Name',
          'Folio Number',
          'Transaction Type',
          'Amount',
          'Units',
          'NAV',
          'Balance Units',
          'Market Value',
          'ISIN',
        ],
        ...body,
        ['Mutual Funds / SIFs Total', null, null, null, total],
      ],
    },
  ]);
}

const txnsOf = (assetId: number) =>
  conn.db
    .select()
    .from(investmentTransactions)
    .where(eq(investmentTransactions.assetId, assetId))
    .all();

describe('importing a Value Research file', () => {
  const file = vrFile([
    [
      '10-Jun-25',
      'Harbor Overnight Fund Direct-G',
      'Sell/Redemption',
      -1020,
      -10,
      102,
      'INF000HO0017',
    ],
    [
      '07-Apr-25',
      'Harbor Overnight Fund Direct-G',
      'Investment in fund',
      2000.1,
      20,
      100,
      'INF000HO0017',
    ],
    [
      '07-Apr-25',
      'Saffron Midcap Fund Direct-G',
      'Investment in fund',
      999.95,
      9.999,
      100,
      'INF000SM0025',
    ],
  ]);

  it('adds new investments with their ISIN, and money moved matches the file', () => {
    const plan = planImport(conn.db, file, NONE);
    expect(plan.problems).toEqual([]);
    expect(plan.add).toHaveLength(3);
    expect(plan.investments.map((i) => [i.isin, i.assetId, i.assetClass])).toEqual([
      ['INF000SM0025', null, 'equity'],
      ['INF000HO0017', null, 'debt'],
    ]);

    expect(applyImport(conn.db, file, NONE, null)).toEqual({ ok: true, added: 3 });
    const added = conn.db
      .select()
      .from(assets)
      .where(inArray(assets.symbol, ['INF000HO0017', 'INF000SM0025']))
      .all();
    expect(added.map((a) => [a.name, a.type, a.valuation, a.accountRef])).toEqual([
      ['Saffron Midcap Fund Direct-G', 'mutual_fund', 'units', 'F-1'],
      ['Harbor Overnight Fund Direct-G', 'mutual_fund', 'units', 'F-1'],
    ]);
    const overnight = txnsOf(added[1]!.id);
    const net = overnight.reduce(
      (s, t) => s + (t.action === 'buy' ? 1 : -1) * (moneyMoved(t) ?? 0),
      0,
    );
    expect(net).toBe(200010 - 102000);
    expect(overnight.every((t) => t.note === 'Imported from Value Research')).toBe(true);
    expect(
      conn.db.select().from(prices).where(eq(prices.assetId, added[1]!.id)).all(),
    ).toHaveLength(2);
    // No account chosen, so nothing in Money.
    const ids = overnight.map((t) => t.id);
    expect(
      conn.db.select().from(transactions).where(inArray(transactions.investmentTxnId, ids)).all(),
    ).toEqual([]);
  });

  it('adds nothing when the same file is imported again', () => {
    const plan = planImport(conn.db, file, NONE);
    expect(plan.add).toEqual([]);
    expect(plan.duplicates).toBe(3);
    expect(plan.investments.every((i) => i.fixed)).toBe(true);
    expect(applyImport(conn.db, file, NONE, null)).toEqual({ ok: false, message: NOTHING_NEW });
  });

  it('adds only the new rows from a longer file', () => {
    const longer = vrFile([
      [
        '01-Jul-25',
        'Harbor Overnight Fund Direct-G',
        'Investment in fund',
        500,
        5,
        100,
        'INF000HO0017',
      ],
      [
        '10-Jun-25',
        'Harbor Overnight Fund Direct-G',
        'Sell/Redemption',
        -1020,
        -10,
        102,
        'INF000HO0017',
      ],
      [
        '07-Apr-25',
        'Harbor Overnight Fund Direct-G',
        'Investment in fund',
        2000.1,
        20,
        100,
        'INF000HO0017',
      ],
    ]);
    const plan = planImport(conn.db, longer, NONE);
    expect(plan.add.map((r) => r.date)).toEqual(['2025-07-01']);
    expect(plan.duplicates).toBe(2);
  });
});

describe('matching an investment already in Hisaab', () => {
  const existing = () =>
    conn.db.select().from(assets).where(eq(assets.name, 'Meridian Flexi Cap Direct-G')).get()!;
  const file = vrFile([
    [
      '03-Mar-25',
      'Meridian Flexi Cap Direct-G',
      'Investment in fund',
      1000,
      10,
      100,
      'INF000MF0012',
    ],
  ]);

  it('suggests the same name, and "new" overrides it', () => {
    expect(planImport(conn.db, file, NONE).investments[0]).toMatchObject({
      assetId: existing().id,
      fixed: false,
      setSymbol: true,
    });
    const asNew = planImport(conn.db, file, { match: { INF000MF0012: 'new' }, assetClass: {} });
    expect(asNew.investments[0]?.assetId).toBeNull();
  });

  it('refuses a chosen investment that no longer exists', () => {
    const plan = planImport(conn.db, file, { match: { INF000MF0012: 99999 }, assetClass: {} });
    expect(plan.problems).toEqual([
      'The investment chosen for Meridian Flexi Cap Direct-G no longer exists. Choose another.',
    ]);
  });

  it('adds to the existing investment, fills in its ISIN and links to the account', () => {
    const before = txnsOf(existing().id).length;
    const account = conn.db
      .select()
      .from(accounts)
      .where(eq(accounts.name, 'Savings account'))
      .get()!;
    expect(applyImport(conn.db, file, NONE, account.id)).toEqual({ ok: true, added: 1 });
    expect(existing().symbol).toBe('INF000MF0012');
    const after = txnsOf(existing().id);
    expect(after).toHaveLength(before + 1);
    const imported = after.find((t) => t.date === '2025-03-03')!;
    expect(
      conn.db
        .select()
        .from(transactions)
        .where(eq(transactions.investmentTxnId, imported.id))
        .get(),
    ).toMatchObject({
      type: 'transfer',
      amount: 100000,
      accountId: account.id,
      toAccountId: null,
      description: 'Buy, Meridian Flexi Cap Direct-G',
    });
    // Now linked by ISIN.
    expect(planImport(conn.db, file, NONE).investments[0]).toMatchObject({ fixed: true, toAdd: 0 });
  });
});

describe('a file that would oversell', () => {
  it('is refused and nothing is written', () => {
    const file = vrFile([
      [
        '10-Jun-25',
        'Banyan Liquid Fund Direct-G',
        'Sell/Redemption',
        -500,
        -5,
        100,
        'INF000BL0019',
      ],
    ]);
    const plan = planImport(conn.db, file, NONE);
    expect(plan.problems).toEqual([
      'The sale of Banyan Liquid Fund Direct-G on 10 Jun 2025 is more than was held then. Import the All-time history, or add the earlier buys first.',
    ]);
    expect(applyImport(conn.db, file, NONE, null)).toEqual({
      ok: false,
      message: plan.problems[0],
    });
    expect(conn.db.select().from(assets).where(eq(assets.symbol, 'INF000BL0019')).all()).toEqual(
      [],
    );
  });
});
