import { ensureDefaults, loadEnv, openDatabase } from '../lib/db/connect.ts';
import {
  addDays,
  addMonths,
  monthEndsBetween,
  monthOf,
  type IsoDate,
} from '../lib/domain/dates.ts';
import {
  accountBalance,
  accountMovement,
  type Flow,
  type OpeningBalance,
} from '../lib/domain/balances.ts';

/**
 * Invented sample data that recreates the look of docs/mockup.html.
 * Every name, amount and holding here is made up. Nothing in this file is real.
 *
 * The generator is seeded, so `npm run seed` produces the same database every time.
 */

const TODAY: IsoDate = '2026-09-28';
const HISTORY_START = '2025-10';
const OPENING_DATE: IsoDate = '2025-10-01';

/* ---------- seeded random ---------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260928);
/** A value within ±spread of 1, e.g. jitter(0.25) → 0.75…1.25 */
const jitter = (spread: number) => 1 + (rnd() * 2 - 1) * spread;

const rupees = (n: number) => Math.round(n * 100);
const dec = (n: number, places = 4) => n.toFixed(places);

/* ---------- invented sample data ---------- */

const ACCOUNTS = [
  { name: 'Salary account', type: 'bank', target: rupees(218450), note: null },
  { name: 'Savings account', type: 'bank', target: rupees(342000), note: null },
  { name: 'Credit card', type: 'card', target: rupees(-18640), note: 'Due 5th of each month' },
  { name: 'Cash', type: 'cash', target: rupees(4200), note: null },
] as const;

/** Monthly income and spending totals the generated history must hit exactly. */
const CASH_HISTORY = [
  { month: '2025-10', income: 152300, spending: 112400 },
  { month: '2025-11', income: 145640, spending: 71300 },
  { month: '2025-12', income: 161200, spending: 83900 },
  { month: '2026-01', income: 145000, spending: 64200 },
  { month: '2026-02', income: 158900, spending: 66800 },
  { month: '2026-03', income: 295000, spending: 92500 },
  { month: '2026-04', income: 145800, spending: 78100 },
  { month: '2026-05', income: 149000, spending: 69400 },
  { month: '2026-06', income: 172500, spending: 104700 },
  { month: '2026-07', income: 145000, spending: 72900 },
  { month: '2026-08', income: 151300, spending: 68300 },
];

const MONTHLY_SALARY = 145000;

/** The recurring spending pattern. The remainder of each month's total goes to one big spend. */
const RECURRING = [
  {
    day: 3,
    desc: 'Rent',
    note: null,
    category: 'Housing',
    account: 'Salary account',
    base: 32000,
    vary: 0,
  },
  {
    day: 6,
    desc: 'Vegetables and fruit',
    note: 'Weekly market',
    category: 'Groceries',
    account: 'Cash',
    base: 1220,
    vary: 0.3,
  },
  {
    day: 7,
    desc: 'Streaming subscriptions',
    note: 'Two services',
    category: 'Entertainment',
    account: 'Credit card',
    base: 737,
    vary: 0,
  },
  {
    day: 8,
    desc: 'Coffee',
    note: 'Brew Lab',
    category: 'Dining',
    account: 'Cash',
    base: 310,
    vary: 0.4,
  },
  {
    day: 12,
    desc: 'Mobile and broadband',
    note: 'Monthly plan',
    category: 'Utilities',
    account: 'Salary account',
    base: 999,
    vary: 0,
  },
  {
    day: 14,
    desc: 'Lunch',
    note: 'Near office',
    category: 'Dining',
    account: 'Credit card',
    base: 540,
    vary: 0.4,
  },
  {
    day: 18,
    desc: 'Auto and metro',
    note: 'Commute',
    category: 'Transport',
    account: 'Cash',
    base: 420,
    vary: 0.4,
  },
  {
    day: 19,
    desc: 'Monthly groceries',
    note: 'Fresh Basket',
    category: 'Groceries',
    account: 'Salary account',
    base: 4120,
    vary: 0.2,
  },
  {
    day: 20,
    desc: 'Pharmacy',
    note: 'Medicines',
    category: 'Health',
    account: 'Cash',
    base: 640,
    vary: 0.5,
  },
  {
    day: 22,
    desc: 'Electricity bill',
    note: 'Monthly usage',
    category: 'Utilities',
    account: 'Salary account',
    base: 2340,
    vary: 0.25,
  },
  {
    day: 23,
    desc: 'Dinner with friends',
    note: 'Coastal Kitchen',
    category: 'Dining',
    account: 'Credit card',
    base: 2380,
    vary: 0.35,
  },
  {
    day: 25,
    desc: 'Petrol',
    note: 'Fuel station',
    category: 'Transport',
    account: 'Credit card',
    base: 2000,
    vary: 0.25,
  },
  {
    day: 26,
    desc: 'Movie tickets',
    note: 'Cineplex',
    category: 'Entertainment',
    account: 'Credit card',
    base: 760,
    vary: 0.3,
  },
  {
    day: 27,
    desc: 'Weekend groceries',
    note: 'Fresh Basket',
    category: 'Groceries',
    account: 'Credit card',
    base: 2140,
    vary: 0.25,
  },
];

/** Where a month's leftover spending goes, so the totals match without odd-looking rows. */
const BIG_SPENDS = [
  {
    desc: 'Festival shopping',
    note: 'Clothes and gifts',
    category: 'Shopping',
    account: 'Credit card',
  },
  { desc: 'Weekend trip', note: 'Travel and stay', category: 'Travel', account: 'Credit card' },
  {
    desc: 'Annual insurance premium',
    note: 'Health cover',
    category: 'Insurance',
    account: 'Salary account',
  },
  { desc: 'Dental treatment', note: 'Two visits', category: 'Health', account: 'Salary account' },
  { desc: 'New laptop', note: 'Online order', category: 'Shopping', account: 'Credit card' },
  { desc: 'Course fees', note: 'Evening class', category: 'Education', account: 'Salary account' },
];

/** September 2026, taken from the mockup. SIPs, the dividend and the card bill are generated. */
const SEPTEMBER = [
  {
    date: '2026-09-28',
    desc: 'Tea and snacks',
    note: 'Office canteen',
    type: 'expense',
    category: 'Dining',
    account: 'Cash',
    amount: 120,
  },
  {
    date: '2026-09-27',
    desc: 'Weekend groceries',
    note: 'Fresh Basket',
    type: 'expense',
    category: 'Groceries',
    account: 'Credit card',
    amount: 2140,
  },
  {
    date: '2026-09-26',
    desc: 'Movie tickets',
    note: 'Cineplex',
    type: 'expense',
    category: 'Entertainment',
    account: 'Credit card',
    amount: 760,
  },
  {
    date: '2026-09-25',
    desc: 'Petrol',
    note: 'Fuel station',
    type: 'expense',
    category: 'Transport',
    account: 'Credit card',
    amount: 2000,
  },
  {
    date: '2026-09-24',
    desc: 'Logo design project',
    note: 'Freelance client',
    type: 'income',
    category: 'Freelance',
    account: 'Savings account',
    amount: 18000,
  },
  {
    date: '2026-09-23',
    desc: 'Dinner with friends',
    note: 'Coastal Kitchen',
    type: 'expense',
    category: 'Dining',
    account: 'Credit card',
    amount: 2380,
  },
  {
    date: '2026-09-22',
    desc: 'Electricity bill',
    note: 'August usage',
    type: 'expense',
    category: 'Utilities',
    account: 'Salary account',
    amount: 2340,
  },
  {
    date: '2026-09-20',
    desc: 'Pharmacy',
    note: 'Medicines',
    type: 'expense',
    category: 'Health',
    account: 'Cash',
    amount: 640,
  },
  {
    date: '2026-09-19',
    desc: 'Monthly groceries',
    note: 'Fresh Basket',
    type: 'expense',
    category: 'Groceries',
    account: 'Salary account',
    amount: 4120,
  },
  {
    date: '2026-09-18',
    desc: 'Auto and metro',
    note: 'Commute',
    type: 'expense',
    category: 'Transport',
    account: 'Cash',
    amount: 420,
  },
  {
    date: '2026-09-16',
    desc: 'Headphones',
    note: 'Online order',
    type: 'expense',
    category: 'Shopping',
    account: 'Credit card',
    amount: 4560,
  },
  {
    date: '2026-09-14',
    desc: 'Lunch',
    note: 'Near office',
    type: 'expense',
    category: 'Dining',
    account: 'Credit card',
    amount: 540,
  },
  {
    date: '2026-09-12',
    desc: 'Mobile and broadband',
    note: 'Monthly plan',
    type: 'expense',
    category: 'Utilities',
    account: 'Salary account',
    amount: 999,
  },
  {
    date: '2026-09-08',
    desc: 'Coffee',
    note: 'Brew Lab',
    type: 'expense',
    category: 'Dining',
    account: 'Cash',
    amount: 310,
  },
  {
    date: '2026-09-07',
    desc: 'Streaming subscriptions',
    note: 'Two services',
    type: 'expense',
    category: 'Entertainment',
    account: 'Credit card',
    amount: 737,
  },
  {
    date: '2026-09-06',
    desc: 'Vegetables and fruit',
    note: 'Weekly market',
    type: 'expense',
    category: 'Groceries',
    account: 'Cash',
    amount: 1220,
  },
  {
    date: '2026-09-05',
    desc: 'Birthday dinner',
    note: 'Coastal Kitchen',
    type: 'expense',
    category: 'Dining',
    account: 'Credit card',
    amount: 3890,
  },
  {
    date: '2026-09-03',
    desc: 'Rent',
    note: 'September',
    type: 'expense',
    category: 'Housing',
    account: 'Salary account',
    amount: 32000,
  },
  {
    date: '2026-09-01',
    desc: 'Salary',
    note: 'September',
    type: 'income',
    category: 'Salary',
    account: 'Salary account',
    amount: 145000,
  },
] as const;

const BUDGETS: Record<string, number> = {
  Housing: 32000,
  Groceries: 12000,
  Dining: 6000,
  Transport: 5000,
  Shopping: 8000,
  Utilities: 5000,
  Entertainment: 3000,
};

type Holding = {
  name: string;
  type: string;
  assetClass: string;
  ref: string;
  units: number;
  unitDecimals: 0 | 4;
  cost: number;
  price: number;
  priceDate: IsoDate;
  dayChange: number;
  plan:
    { kind: 'sip'; amount: number; count: number } | { kind: 'lumps'; buys: [IsoDate, number][] };
};

const HOLDINGS: Holding[] = [
  {
    name: 'Meridian Flexi Cap Direct-G',
    type: 'mutual_fund',
    assetClass: 'equity',
    ref: 'Folio ••7731',
    units: 1660.12,
    unitDecimals: 4,
    cost: 320000,
    price: 231.46,
    priceDate: '2026-09-25',
    dayChange: 0.42,
    plan: { kind: 'sip', amount: 10000, count: 32 },
  },
  {
    name: 'Banyan Nifty 50 Index Direct-G',
    type: 'mutual_fund',
    assetClass: 'equity',
    ref: 'Folio ••2210',
    units: 11520.4,
    unitDecimals: 4,
    cost: 240000,
    price: 24.87,
    priceDate: '2026-09-25',
    dayChange: -0.31,
    plan: { kind: 'sip', amount: 10000, count: 24 },
  },
  {
    name: 'Saffron Small Cap Direct-G',
    type: 'mutual_fund',
    assetClass: 'equity',
    ref: 'Folio ••5094',
    units: 2290.5,
    unitDecimals: 4,
    cost: 120000,
    price: 61.12,
    priceDate: '2026-09-25',
    dayChange: -0.46,
    plan: { kind: 'sip', amount: 5000, count: 24 },
  },
  {
    name: 'Harbor Short Duration Direct-G',
    type: 'mutual_fund',
    assetClass: 'debt',
    ref: 'Folio ••3318',
    units: 2748.1,
    unitDecimals: 4,
    cost: 100000,
    price: 39.64,
    priceDate: '2026-09-25',
    dayChange: 0.02,
    plan: { kind: 'sip', amount: 5000, count: 20 },
  },
  {
    name: 'Meridian ELSS Tax Saver Direct-G',
    type: 'mutual_fund',
    assetClass: 'equity',
    ref: 'Folio ••7731',
    units: 917.04,
    unitDecimals: 4,
    cost: 120000,
    price: 148.2,
    priceDate: '2026-09-25',
    dayChange: 0.37,
    plan: { kind: 'sip', amount: 5000, count: 24 },
  },
  {
    name: 'Kaveri Power Ltd',
    type: 'stock',
    assetClass: 'equity',
    ref: 'Demat ••4402',
    units: 120,
    unitDecimals: 0,
    cost: 177600,
    price: 1642.35,
    priceDate: '2026-09-28',
    dayChange: 1.12,
    plan: {
      kind: 'lumps',
      buys: [
        ['2024-03-14', 40],
        ['2025-01-20', 40],
        ['2025-11-06', 40],
      ],
    },
  },
  {
    name: 'Sahyadri Foods Ltd',
    type: 'stock',
    assetClass: 'equity',
    ref: 'Demat ••4402',
    units: 45,
    unitDecimals: 0,
    cost: 144450,
    price: 2958.1,
    priceDate: '2026-09-28',
    dayChange: -0.64,
    plan: {
      kind: 'lumps',
      buys: [
        ['2024-06-11', 25],
        ['2025-07-22', 20],
      ],
    },
  },
  {
    name: 'Deccan Bank Ltd',
    type: 'stock',
    assetClass: 'equity',
    ref: 'Demat ••4402',
    units: 200,
    unitDecimals: 0,
    cost: 162400,
    price: 868.9,
    priceDate: '2026-09-28',
    dayChange: -0.87,
    plan: {
      kind: 'lumps',
      buys: [
        ['2023-11-08', 80],
        ['2024-09-17', 60],
        ['2025-06-03', 60],
      ],
    },
  },
  {
    name: 'Banyan Nifty Next 50 ETF',
    type: 'etf',
    assetClass: 'equity',
    ref: 'Demat ••4402',
    units: 900,
    unitDecimals: 0,
    cost: 61560,
    price: 74.18,
    priceDate: '2026-09-28',
    dayChange: -0.22,
    plan: {
      kind: 'lumps',
      buys: [
        ['2024-05-21', 300],
        ['2025-02-12', 300],
        ['2025-10-09', 300],
      ],
    },
  },
  {
    name: 'Banyan Gold ETF',
    type: 'gold',
    assetClass: 'gold',
    ref: 'Demat ••4402',
    units: 1200,
    unitDecimals: 0,
    cost: 86520,
    price: 96.4,
    priceDate: '2026-09-28',
    dayChange: 0.58,
    plan: {
      kind: 'lumps',
      buys: [
        ['2023-08-18', 500],
        ['2024-12-05', 400],
        ['2025-09-15', 300],
      ],
    },
  },
  {
    name: 'Gold bond, 2031 series',
    type: 'gold',
    assetClass: 'gold',
    ref: 'Demat ••4402',
    units: 12,
    unitDecimals: 0,
    cost: 70680,
    price: 9780,
    priceDate: '2026-09-28',
    dayChange: 0.61,
    plan: {
      kind: 'lumps',
      buys: [
        ['2024-02-27', 6],
        ['2025-04-16', 6],
      ],
    },
  },
];

/* ---------- write ---------- */

loadEnv();
const { sqlite } = openDatabase();

const WIPE = [
  'transactions',
  'investment_transactions',
  'prices',
  'valuations',
  'budgets',
  'assets',
  'categories',
  'accounts',
  'settings',
];

sqlite.transaction(() => {
  for (const table of WIPE) sqlite.prepare(`DELETE FROM ${table}`).run();
  sqlite.prepare('DELETE FROM sqlite_sequence').run();
})();
ensureDefaults(sqlite);

const insertAccount = sqlite.prepare(
  `INSERT INTO accounts (name, type, opening_balance, opening_date, note, sort_order) VALUES (?, ?, 0, ?, ?, ?)`,
);
const insertTxn = sqlite.prepare(
  `INSERT INTO transactions (date, type, amount, account_id, to_account_id, category_id, description, note, investment_txn_id)
   VALUES (@date, @type, @amount, @accountId, @toAccountId, @categoryId, @description, @note, @investmentTxnId)`,
);
const insertAsset = sqlite.prepare(
  `INSERT INTO assets (name, type, asset_class, valuation, account_ref, interest_rate, compounding, start_date, maturity_date, note)
   VALUES (@name, @type, @assetClass, @valuation, @accountRef, @interestRate, @compounding, @startDate, @maturityDate, @note)`,
);
const insertInvTxn = sqlite.prepare(
  `INSERT INTO investment_transactions (asset_id, date, action, units, price, amount, fees, note)
   VALUES (@assetId, @date, @action, @units, @price, @amount, @fees, @note)`,
);
const insertPrice = sqlite.prepare(
  `INSERT OR REPLACE INTO prices (asset_id, date, price, source) VALUES (?, ?, ?, 'manual')`,
);
const insertValuation = sqlite.prepare(
  `INSERT OR REPLACE INTO valuations (asset_id, date, value) VALUES (?, ?, ?)`,
);
const insertBudget = sqlite.prepare(
  `INSERT INTO budgets (category_id, start_month, amount) VALUES (?, ?, ?)`,
);
const setSetting = sqlite.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
);
const flows = () =>
  sqlite
    .prepare(
      `SELECT date, type, amount, account_id AS accountId, to_account_id AS toAccountId FROM transactions`,
    )
    .all() as Flow[];

type TxnRow = {
  date: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  accountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  description: string;
  note: string | null;
  investmentTxnId: number | null;
};

const txn = (
  row: Partial<TxnRow> & Pick<TxnRow, 'date' | 'type' | 'amount' | 'description'>,
): TxnRow => ({
  accountId: null,
  toAccountId: null,
  categoryId: null,
  note: null,
  investmentTxnId: null,
  ...row,
});

sqlite.transaction(() => {
  /* accounts */
  const accountId = new Map<string, number>();
  ACCOUNTS.forEach((a, i) => {
    const info = insertAccount.run(a.name, a.type, OPENING_DATE, a.note, i);
    accountId.set(a.name, Number(info.lastInsertRowid));
  });
  const acct = (name: string) => accountId.get(name)!;

  /* categories */
  const categoryId = new Map<string, number>();
  for (const row of sqlite.prepare('SELECT id, name, kind FROM categories').all() as {
    id: number;
    name: string;
    kind: string;
  }[]) {
    categoryId.set(`${row.kind}:${row.name}`, row.id);
  }
  const cat = (kind: 'income' | 'expense', name: string) => categoryId.get(`${kind}:${name}`)!;

  /* ---------- investments ---------- */
  for (const h of HOLDINGS) {
    const assetInfo = insertAsset.run({
      name: h.name,
      type: h.type,
      assetClass: h.assetClass,
      valuation: 'units',
      accountRef: h.ref,
      interestRate: null,
      compounding: null,
      startDate: null,
      maturityDate: null,
      note: null,
    });
    const assetId = Number(assetInfo.lastInsertRowid);

    // Buys: amounts are fixed, so the total cost is right; the last buy's units are
    // adjusted so the final unit count matches exactly.
    const buys: { date: IsoDate; units: number; price: number; amount: number }[] = [];
    if (h.plan.kind === 'sip') {
      const { amount, count } = h.plan;
      const firstMonth = addMonths('2026-09', -(count - 1));
      const avgPrice = h.cost / h.units;
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const price = avgPrice * (0.78 + 0.42 * t) * jitter(0.035);
        buys.push({ date: `${addMonths(firstMonth, i)}-10`, units: 0, price, amount });
      }
      // Scale the curve so the buys add up to the target units; the last buy then only
      // absorbs rounding instead of a wildly different price.
      const units = buys.reduce((sum, b) => sum + amount / b.price, 0);
      for (const b of buys) b.price *= units / h.units;
    } else {
      const avgPrice = h.cost / h.units;
      const lumps = h.plan.buys;
      lumps.forEach(([date, units], i) => {
        const t = i / Math.max(1, lumps.length - 1);
        const price = avgPrice * (0.85 + 0.3 * t) * jitter(0.04);
        buys.push({ date, units, price, amount: 0 });
      });
    }

    if (h.plan.kind === 'sip') {
      let used = 0;
      for (let i = 0; i < buys.length; i++) {
        const b = buys[i]!;
        if (i < buys.length - 1) {
          b.units = Number((b.amount / b.price).toFixed(4));
          used += b.units;
        } else {
          b.units = Number((h.units - used).toFixed(4));
          b.price = Number((b.amount / b.units).toFixed(4));
        }
        // A SIP debits exactly its amount; units × price differs from it only by rounding.
        b.amount = rupees(b.amount);
      }
    } else {
      // Whole units: adjust the last price so the total cost lands on target.
      let spent = 0;
      for (let i = 0; i < buys.length; i++) {
        const b = buys[i]!;
        if (i < buys.length - 1) {
          b.price = Number(b.price.toFixed(4));
          b.amount = rupees(Number((b.units * b.price).toFixed(2)));
          spent += b.amount;
        } else {
          b.amount = rupees(h.cost) - spent;
          b.price = Number((b.amount / 100 / b.units).toFixed(4));
          b.amount = rupees(Number((b.units * b.price).toFixed(2)));
        }
      }
    }

    for (const b of buys) {
      const invInfo = insertInvTxn.run({
        assetId,
        date: b.date,
        action: 'buy',
        units: dec(b.units, h.unitDecimals === 0 ? 0 : 4),
        price: dec(b.price),
        amount: b.amount,
        fees: 0,
        note: null,
      });
      // SIPs are paid from the salary account, which creates the linked money transaction.
      if (h.plan.kind === 'sip') {
        insertTxn.run(
          txn({
            date: b.date,
            type: 'transfer',
            amount: b.amount,
            accountId: acct('Salary account'),
            description: `${h.name.split(' Direct')[0]} SIP`,
            note: 'Monthly SIP',
            investmentTxnId: Number(invInfo.lastInsertRowid),
          }),
        );
      }
    }

    /* prices: a gentle walk backwards from the price before the latest one */
    const previous = Number((h.price / (1 + h.dayChange / 100)).toFixed(4));
    const monthEnds = monthEndsBetween(monthOf(buys[0]!.date), '2026-08');
    let p = previous;
    const walked: [IsoDate, number][] = [];
    for (let i = monthEnds.length - 1; i >= 0; i--) {
      walked.unshift([monthEnds[i]!, Number(p.toFixed(4))]);
      p = p / (1.008 * jitter(0.03));
    }
    for (const [date, price] of walked) insertPrice.run(assetId, date, dec(price));
    insertPrice.run(assetId, addDays(h.priceDate, -3), dec(previous));
    insertPrice.run(assetId, h.priceDate, dec(h.price));
  }

  /* fixed deposit: one deposit, valued from its rate */
  const fdStart: IsoDate = '2026-01-22';
  const fdId = Number(
    insertAsset.run({
      name: 'Fixed deposit, 7.1%',
      type: 'fixed_deposit',
      assetClass: 'debt',
      valuation: 'fd',
      accountRef: 'Savings account',
      interestRate: '7.10',
      compounding: 'quarterly',
      startDate: fdStart,
      maturityDate: '2028-01-22',
      note: null,
    }).lastInsertRowid,
  );
  const fdTxn = insertInvTxn.run({
    assetId: fdId,
    date: fdStart,
    action: 'deposit',
    units: null,
    price: null,
    amount: rupees(100000),
    fees: 0,
    note: null,
  });
  insertTxn.run(
    txn({
      date: fdStart,
      type: 'transfer',
      amount: rupees(100000),
      accountId: acct('Savings account'),
      description: 'Fixed deposit, 7.1%',
      note: 'Two year deposit',
      investmentTxnId: Number(fdTxn.lastInsertRowid),
    }),
  );

  /* PPF: yearly deposits, balance entered by hand from the statement */
  const ppfId = Number(
    insertAsset.run({
      name: 'PPF account',
      type: 'ppf',
      assetClass: 'debt',
      valuation: 'manual',
      accountRef: 'Matures 2034',
      interestRate: '7.10',
      compounding: 'yearly',
      startDate: '2023-04-10',
      maturityDate: '2034-03-31',
      note: null,
    }).lastInsertRowid,
  );
  const ppfDeposits: [IsoDate, number][] = [
    ['2023-04-10', 50000],
    ['2024-04-10', 50000],
    ['2025-04-10', 40000],
    ['2026-04-10', 40000],
  ];
  for (const [date, amount] of ppfDeposits) {
    const inv = insertInvTxn.run({
      assetId: ppfId,
      date,
      action: 'deposit',
      units: null,
      price: null,
      amount: rupees(amount),
      fees: 0,
      note: null,
    });
    if (date >= OPENING_DATE) {
      insertTxn.run(
        txn({
          date,
          type: 'transfer',
          amount: rupees(amount),
          accountId: acct('Savings account'),
          description: 'PPF deposit',
          note: 'Yearly contribution',
          investmentTxnId: Number(inv.lastInsertRowid),
        }),
      );
    }
  }
  insertValuation.run(ppfId, '2025-09-30', rupees(158200));
  insertValuation.run(ppfId, '2026-03-31', rupees(181900));
  insertValuation.run(ppfId, TODAY, rupees(206400));

  /* a dividend, which pays into the salary account */
  const kaveriId = (
    sqlite.prepare('SELECT id FROM assets WHERE name = ?').get('Kaveri Power Ltd') as { id: number }
  ).id;
  const dividend = insertInvTxn.run({
    assetId: kaveriId,
    date: '2026-09-17',
    action: 'dividend',
    units: null,
    price: null,
    amount: rupees(640),
    fees: 0,
    note: null,
  });
  insertTxn.run(
    txn({
      date: '2026-09-17',
      type: 'income',
      amount: rupees(640),
      accountId: acct('Salary account'),
      categoryId: cat('income', 'Dividends'),
      description: 'Dividend',
      note: 'Kaveri Power Ltd',
      investmentTxnId: Number(dividend.lastInsertRowid),
    }),
  );

  /* ---------- money history, Oct 2025 to Aug 2026 ---------- */
  const cardSpendByMonth = new Map<string, number>();
  const addCardSpend = (date: string, amount: number) => {
    const key = monthOf(date);
    cardSpendByMonth.set(key, (cardSpendByMonth.get(key) ?? 0) + amount);
  };

  CASH_HISTORY.forEach((month, index) => {
    /* income */
    insertTxn.run(
      txn({
        date: `${month.month}-01`,
        type: 'income',
        amount: rupees(MONTHLY_SALARY),
        accountId: acct('Salary account'),
        categoryId: cat('income', 'Salary'),
        description: 'Salary',
        note: null,
      }),
    );
    const extra = month.income - MONTHLY_SALARY;
    if (extra >= 100000) {
      insertTxn.run(
        txn({
          date: `${month.month}-28`,
          type: 'income',
          amount: rupees(extra),
          accountId: acct('Salary account'),
          categoryId: cat('income', 'Salary'),
          description: 'Annual bonus',
          note: null,
        }),
      );
    } else if (extra > 0) {
      insertTxn.run(
        txn({
          date: `${month.month}-24`,
          type: 'income',
          amount: rupees(extra),
          accountId: acct('Savings account'),
          categoryId: cat('income', 'Freelance'),
          description: 'Freelance project',
          note: 'Design work',
        }),
      );
    }

    /* spending: recurring rows first, then one big spend for the remainder */
    let spent = 0;
    for (const item of RECURRING) {
      const amount = rupees(Math.round(item.base * (item.vary ? jitter(item.vary) : 1)));
      spent += amount;
      const date = `${month.month}-${String(item.day).padStart(2, '0')}`;
      insertTxn.run(
        txn({
          date,
          type: 'expense',
          amount,
          accountId: acct(item.account),
          categoryId: cat('expense', item.category),
          description: item.desc,
          note: item.note,
        }),
      );
      if (item.account === 'Credit card') addCardSpend(date, amount);
    }

    const remainder = rupees(month.spending) - spent;
    if (remainder > 0) {
      const big = BIG_SPENDS[index % BIG_SPENDS.length]!;
      const date = `${month.month}-16`;
      insertTxn.run(
        txn({
          date,
          type: 'expense',
          amount: remainder,
          accountId: acct(big.account),
          categoryId: cat('expense', big.category),
          description: big.desc,
          note: big.note,
        }),
      );
      if (big.account === 'Credit card') addCardSpend(date, remainder);
    } else {
      // Trim the largest recurring row instead of inventing a negative spend.
      sqlite
        .prepare(
          `UPDATE transactions SET amount = amount + ?
           WHERE id = (SELECT id FROM transactions
                       WHERE type='expense' AND date LIKE ? ORDER BY amount DESC LIMIT 1)`,
        )
        .run(remainder, `${month.month}-%`);
      if (remainder < 0) addCardSpend(`${month.month}-03`, 0);
    }
  });

  /* September 2026 */
  for (const row of SEPTEMBER) {
    const amount = rupees(row.amount);
    insertTxn.run(
      txn({
        date: row.date,
        type: row.type,
        amount,
        accountId: acct(row.account),
        categoryId: cat(row.type === 'income' ? 'income' : 'expense', row.category),
        description: row.desc,
        note: row.note,
      }),
    );
    if (row.account === 'Credit card' && row.type === 'expense') addCardSpend(row.date, amount);
  }

  /* the card bill: each month's card spending, paid on the 15th of the next month */
  for (const [month, amount] of [...cardSpendByMonth].sort()) {
    const payMonth = addMonths(month, 1);
    if (payMonth > '2026-09' || amount <= 0) continue;
    insertTxn.run(
      txn({
        date: `${payMonth}-15`,
        type: 'transfer',
        amount,
        accountId: acct('Salary account'),
        toAccountId: acct('Credit card'),
        description: 'Credit card bill',
        note: 'Previous statement',
      }),
    );
  }

  /* budgets, carried forward from the first month of history */
  for (const [name, amount] of Object.entries(BUDGETS)) {
    insertBudget.run(cat('expense', name), HISTORY_START, rupees(amount));
  }

  /* opening balances, chosen so the balances on 28 Sep 2026 match the mockup.
     Solved with the app's own balance rule, so both always agree. */
  const setOpening = sqlite.prepare('UPDATE accounts SET opening_balance = ? WHERE id = ?');
  const all = flows();
  for (const a of ACCOUNTS) {
    const id = acct(a.name);
    const net = accountMovement({ id, openingBalance: 0, openingDate: OPENING_DATE }, all, TODAY);
    setOpening.run(a.target - net, id);
  }

  setSetting.run('sample_data', 'true');
})();

/* ---------- report ---------- */
const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

console.log('Sample data loaded (all of it invented):');
console.log(`  ${count('accounts')} accounts, ${count('categories')} categories`);
console.log(`  ${count('transactions')} money transactions`);
console.log(
  `  ${count('assets')} investments, ${count('investment_transactions')} investment transactions`,
);
console.log(
  `  ${count('prices')} prices, ${count('valuations')} valuations, ${count('budgets')} budgets`,
);

const all = flows();
for (const row of sqlite
  .prepare(
    `SELECT id, name, opening_balance AS openingBalance, opening_date AS openingDate
     FROM accounts ORDER BY sort_order`,
  )
  .all() as (OpeningBalance & { name: string })[]) {
  console.log(
    `  ${row.name} on ${TODAY}: ₹${(accountBalance(row, all, TODAY) / 100).toLocaleString('en-IN')}`,
  );
}

sqlite.close();
