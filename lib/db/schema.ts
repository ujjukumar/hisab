import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

/* Money is INTEGER paise. Units, prices and rates are TEXT decimal strings.
   Dates are TEXT 'YYYY-MM-DD', months 'YYYY-MM', timestamps ISO 8601. */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const stamps = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
};

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type', { enum: ['bank', 'card', 'cash', 'wallet', 'other'] }).notNull(),
  openingBalance: integer('opening_balance').notNull().default(0),
  openingDate: text('opening_date').notNull(),
  note: text('note'),
  archived: integer('archived').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  ...stamps,
});

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    color: text('color').notNull(),
    archived: integer('archived').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    ...stamps,
  },
  (t) => [unique('categories_name_kind').on(t.name, t.kind)],
);

export const investmentTransactions = sqliteTable(
  'investment_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assetId: integer('asset_id')
      .notNull()
      .references((): typeof assets.id => assets.id),
    date: text('date').notNull(),
    action: text('action', {
      enum: [
        'buy',
        'sell',
        'split',
        'deposit',
        'withdrawal',
        'dividend',
        'interest',
        'fee',
      ],
    }).notNull(),
    units: text('units'),
    price: text('price'),
    amount: integer('amount'),
    fees: integer('fees').notNull().default(0),
    splitFrom: integer('split_from'),
    splitTo: integer('split_to'),
    note: text('note'),
    ...stamps,
  },
  (t) => [index('investment_transactions_asset_date').on(t.assetId, t.date)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
    amount: integer('amount').notNull(),
    accountId: integer('account_id').references(() => accounts.id),
    toAccountId: integer('to_account_id').references(() => accounts.id),
    categoryId: integer('category_id').references(() => categories.id),
    description: text('description').notNull(),
    note: text('note'),
    investmentTxnId: integer('investment_txn_id').references(() => investmentTransactions.id, {
      onDelete: 'cascade',
    }),
    ...stamps,
  },
  (t) => [
    index('transactions_date').on(t.date),
    index('transactions_account_date').on(t.accountId, t.date),
    index('transactions_to_account_date').on(t.toAccountId, t.date),
    index('transactions_category_date').on(t.categoryId, t.date),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
    check(
      'transactions_shape',
      sql`(
        (${t.type} IN ('income','expense')
          AND ${t.accountId} IS NOT NULL
          AND ${t.categoryId} IS NOT NULL
          AND ${t.toAccountId} IS NULL)
        OR
        (${t.type} = 'transfer'
          AND ${t.categoryId} IS NULL
          AND (${t.accountId} IS NOT NULL OR ${t.toAccountId} IS NOT NULL)
          AND (${t.accountId} IS NOT NULL OR ${t.investmentTxnId} IS NOT NULL)
          AND (${t.toAccountId} IS NOT NULL OR ${t.investmentTxnId} IS NOT NULL)
          AND (${t.accountId} IS NULL OR ${t.toAccountId} IS NULL OR ${t.accountId} != ${t.toAccountId}))
      )`,
    ),
  ],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    startMonth: text('start_month').notNull(),
    amount: integer('amount').notNull(),
    ...stamps,
  },
  (t) => [unique('budgets_category_month').on(t.categoryId, t.startMonth)],
);

export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', {
    enum: [
      'mutual_fund',
      'stock',
      'etf',
      'gold',
      'fixed_deposit',
      'ppf',
      'epf',
      'nps',
      'bond',
      'other',
    ],
  }).notNull(),
  assetClass: text('asset_class', { enum: ['equity', 'debt', 'gold', 'other'] }).notNull(),
  valuation: text('valuation', { enum: ['units', 'manual', 'fd'] }).notNull(),
  symbol: text('symbol'),
  navStartDate: text('nav_start_date'),
  accountRef: text('account_ref'),
  interestRate: text('interest_rate'),
  compounding: text('compounding', {
    enum: ['quarterly', 'monthly', 'half_yearly', 'yearly', 'simple'],
  }),
  startDate: text('start_date'),
  maturityDate: text('maturity_date'),
  note: text('note'),
  archived: integer('archived').notNull().default(0),
  ...stamps,
});

export const prices = sqliteTable(
  'prices',
  {
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id),
    date: text('date').notNull(),
    price: text('price').notNull(),
    source: text('source', { enum: ['manual', 'import', 'auto'] })
      .notNull()
      .default('manual'),
    ...stamps,
  },
  (t) => [primaryKey({ columns: [t.assetId, t.date] })],
);

export const valuations = sqliteTable(
  'valuations',
  {
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id),
    date: text('date').notNull(),
    value: integer('value').notNull(),
    ...stamps,
  },
  (t) => [primaryKey({ columns: [t.assetId, t.date] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  ...stamps,
});

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;

export type AccountType = Account['type'];
export type AssetType = Asset['type'];
export type InvestmentAction = InvestmentTransaction['action'];
