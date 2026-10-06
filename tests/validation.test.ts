import { describe, expect, it } from 'vitest';
import { assetSchema } from '@/lib/validation/investments';
import { accountSchema, budgetSchema, transactionSchema } from '@/lib/validation/money';

const base = {
  type: 'expense',
  amount: '1,250.50',
  date: '2026-09-14',
  categoryId: '3',
  accountId: '1',
  toAccountId: '2',
  description: '  Weekly groceries ',
  note: '',
};

const errors = (input: object) => {
  const r = transactionSchema.safeParse(input);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('assetSchema', () => {
  const fund = {
    name: 'Invented NFO',
    type: 'mutual_fund',
    assetClass: 'equity',
    accountRef: '',
    symbol: 'INF000MF0012',
    navStartDate: '2025-02-25',
    interestRate: '',
    compounding: '',
    startDate: '',
    maturityDate: '',
    note: '',
  };

  it('keeps a valid first NAV date for mutual funds and clears it for other kinds', () => {
    expect(assetSchema.parse(fund).navStartDate).toBe('2025-02-25');
    expect(assetSchema.parse({ ...fund, type: 'stock' }).navStartDate).toBeNull();
  });

  it('rejects an invalid first NAV date', () => {
    expect(assetSchema.safeParse({ ...fund, navStartDate: '2025-02-30' }).success).toBe(false);
  });
});

describe('transactionSchema', () => {
  it('parses a spending row and drops the to-account', () => {
    const r = transactionSchema.parse(base);
    expect(r).toMatchObject({
      amount: 125050,
      categoryId: 3,
      accountId: 1,
      toAccountId: null,
      description: 'Weekly groceries',
      note: null,
    });
  });

  it('drops the category on a transfer', () => {
    expect(transactionSchema.parse({ ...base, type: 'transfer' })).toMatchObject({
      categoryId: null,
      toAccountId: 2,
    });
  });

  it('asks for an amount above zero', () => {
    expect(errors({ ...base, amount: '' }).amount).toBe('Enter an amount greater than zero.');
    expect(errors({ ...base, amount: '0' }).amount).toBe('Enter an amount greater than zero.');
    expect(errors({ ...base, amount: '-5' }).amount).toBe('Enter an amount greater than zero.');
  });

  it('rejects a transfer to the same account', () => {
    expect(errors({ ...base, type: 'transfer', toAccountId: '1' }).toAccountId).toBe(
      'Choose two different accounts for a transfer.',
    );
  });

  it('needs a category and account for spending and income', () => {
    const e = errors({ ...base, type: 'income', categoryId: '', accountId: '' });
    expect(e.categoryId).toBe('Choose a category.');
    expect(e.accountId).toBe('Choose an account.');
  });

  it('rejects an impossible date and an empty description', () => {
    const e = errors({ ...base, date: '2026-02-29', description: '   ' });
    expect(e.date).toBe('Pick a date for this transaction.');
    expect(e.description).toBe('Add a short description so you can find this later.');
  });
});

describe('accountSchema', () => {
  const account = {
    name: 'Credit card',
    type: 'card',
    openingBalance: '',
    openingDate: '2026-04-01',
    note: '',
  };

  it('treats an empty opening balance as zero', () => {
    expect(accountSchema.parse(account).openingBalance).toBe(0);
  });

  it('keeps a negative opening balance, with either minus sign', () => {
    expect(accountSchema.parse({ ...account, openingBalance: '−18,640' }).openingBalance).toBe(
      -1864000,
    );
    expect(accountSchema.parse({ ...account, openingBalance: '-18640.5' }).openingBalance).toBe(
      -1864050,
    );
  });
});

describe('budgetSchema', () => {
  const budget = { categoryId: 3, month: '2026-09', amount: '12,000' };

  it('parses the amount into paise', () => {
    expect(budgetSchema.parse(budget).amount).toBe(1200000);
  });

  it('treats an empty amount as 0, meaning no budget', () => {
    expect(budgetSchema.parse({ ...budget, amount: '' }).amount).toBe(0);
    expect(budgetSchema.parse({ ...budget, amount: '0' }).amount).toBe(0);
  });

  it('rejects a negative amount and a bad month', () => {
    const result = budgetSchema.safeParse({ ...budget, amount: '-500', month: '2026-13' });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain('amount');
    expect(paths).toContain('month');
  });
});
