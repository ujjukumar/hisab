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

export const smsDevices = sqliteTable(
  'sms_devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    installationId: text('installation_id'),
    /** Set once the owner approves the request, or when the phone redeems a QR code. */
    tokenHash: text('token_hash').unique(),
    /** Hash of the secret the phone keeps while waiting for approval. Null for QR pairing. */
    claimHash: text('claim_hash').unique(),
    /** Short code to compare on the phone and in Money -> SMS. Null for QR pairing. */
    code: text('code'),
    tokenCiphertext: text('token_ciphertext'),
    approvedAt: text('approved_at'),
    claimedAt: text('claimed_at'),
    createdAt: text('created_at').notNull().default(now),
    lastSeenAt: text('last_seen_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('sms_devices_installation').on(t.installationId), index('sms_devices_claim').on(t.claimHash)],
);

/** One-time QR pairing codes. Only a hash of the secret is kept; each code pairs one phone. */
export const smsPairingInvites = sqliteTable('sms_pairing_invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  secretHash: text('secret_hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(now),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  /** The device the code paired, once it has been used. */
  deviceId: integer('device_id').references(() => smsDevices.id),
});

export const smsRules = sqliteTable(
  'sms_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    senderPattern: text('sender_pattern').notNull(),
    providerKey: text('provider_key').notNull(),
    templateFingerprint: text('template_fingerprint').notNull(),
    enabled: integer('enabled').notNull().default(1),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    incomeCategoryId: integer('income_category_id').references(() => categories.id),
    expenseCategoryId: integer('expense_category_id').references(() => categories.id),
    /** Money in becomes a transfer from this account instead of income. Excludes a category. */
    incomeTransferAccountId: integer('income_transfer_account_id').references(() => accounts.id),
    /** Money out becomes a transfer to this account instead of spending. Excludes a category. */
    expenseTransferAccountId: integer('expense_transfer_account_id').references(
      () => accounts.id,
    ),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('sms_rules_provider').on(t.providerKey), index('sms_rules_sender').on(t.senderPattern)],
);

export const smsMessages = sqliteTable(
  'sms_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id')
      .notNull()
      .references(() => smsDevices.id),
    providerMessageId: text('provider_message_id'),
    sender: text('sender').notNull(),
    receivedAt: text('received_at').notNull(),
    contentHash: text('content_hash').notNull(),
    rawCiphertext: text('raw_ciphertext'),
    status: text('status', { enum: ['pending', 'imported', 'rejected', 'duplicate', 'failed'] })
      .notNull()
      .default('pending'),
    parserVersion: text('parser_version').notNull(),
    providerKey: text('provider_key'),
    senderPattern: text('sender_pattern'),
    templateFingerprint: text('template_fingerprint'),
    direction: text('direction', { enum: ['income', 'expense'] }),
    amount: integer('amount'),
    transactionDate: text('transaction_date'),
    reference: text('reference'),
    proposedAccountId: integer('proposed_account_id').references(() => accounts.id),
    proposedCategoryId: integer('proposed_category_id').references(() => categories.id),
    /** For a transfer, the account the money went to; `proposedAccountId` is where it left. */
    proposedToAccountId: integer('proposed_to_account_id').references(() => accounts.id),
    transactionId: integer('transaction_id').references(() => transactions.id),
    reason: text('reason'),
    /** The rule that imported this SMS, or that the owner taught while approving it. */
    ruleId: integer('rule_id').references(() => smsRules.id, { onDelete: 'set null' }),
    /** Who decided: a learned rule or the owner. Null while the SMS waits for review. */
    decidedBy: text('decided_by', { enum: ['rule', 'owner'] }),
    decidedAt: text('decided_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('sms_messages_status').on(t.status),
    index('sms_messages_hash').on(t.contentHash),
    index('sms_messages_provider_id').on(t.deviceId, t.providerMessageId),
    index('sms_messages_rule').on(t.ruleId),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;
export type SmsDevice = typeof smsDevices.$inferSelect;
export type SmsPairingInvite = typeof smsPairingInvites.$inferSelect;
export type SmsRule = typeof smsRules.$inferSelect;
export type SmsMessage = typeof smsMessages.$inferSelect;

export type AccountType = Account['type'];
export type AssetType = Asset['type'];
export type InvestmentAction = InvestmentTransaction['action'];
