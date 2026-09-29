import { describe, expect, it } from 'vitest';
import { accountBalance, summarise, type Flow } from '@/lib/domain/balances';

const bank = { id: 1, openingBalance: 100000, openingDate: '2026-04-01' };
const card = { id: 2, openingBalance: -5000, openingDate: '2026-04-01' };
const cash = { id: 3, openingBalance: 0, openingDate: '2026-04-01' };

const f = (
  date: string,
  type: Flow['type'],
  amount: number,
  accountId: number | null,
  toAccountId: number | null = null,
): Flow => ({
  date,
  type,
  amount,
  accountId,
  toAccountId,
});

describe('accountBalance', () => {
  it('adds income and takes away spending', () => {
    const flows = [f('2026-04-05', 'income', 50000, 1), f('2026-04-06', 'expense', 20000, 1)];
    expect(accountBalance(bank, flows, '2026-04-30')).toBe(130000);
  });

  it('moves transfers out of one account and into the other', () => {
    const flows = [f('2026-04-10', 'transfer', 3000, 1, 3)];
    expect(accountBalance(bank, flows, '2026-04-30')).toBe(97000);
    expect(accountBalance(cash, flows, '2026-04-30')).toBe(3000);
  });

  it('keeps money owed on a card negative, and paying the bill brings it to zero', () => {
    const flows = [f('2026-04-08', 'expense', 2000, 2), f('2026-04-15', 'transfer', 7000, 1, 2)];
    expect(accountBalance(card, flows, '2026-04-10')).toBe(-7000);
    expect(accountBalance(card, flows, '2026-04-30')).toBe(0);
  });

  it('ignores transactions before the opening date and after the balance date', () => {
    const flows = [
      f('2026-03-31', 'income', 99999, 1),
      f('2026-04-01', 'income', 1000, 1),
      f('2026-04-30', 'expense', 500, 1),
      f('2026-05-01', 'expense', 88888, 1),
    ];
    expect(accountBalance(bank, flows, '2026-04-30')).toBe(100500);
  });

  it('counts only the account side of a transfer to or from investments', () => {
    const flows = [
      f('2026-04-10', 'transfer', 4000, 1, null),
      f('2026-04-11', 'transfer', 1500, null, 1),
    ];
    expect(accountBalance(bank, flows, '2026-04-30')).toBe(97500);
  });

  it('is the opening balance when there are no transactions', () => {
    expect(accountBalance(card, [], '2026-04-30')).toBe(-5000);
  });
});

describe('summarise', () => {
  it('adds up income and spending, and leaves transfers out', () => {
    const s = summarise([
      f('2026-04-01', 'income', 100000, 1),
      f('2026-04-02', 'income', 20000, 1),
      f('2026-04-03', 'expense', 30000, 1),
      f('2026-04-04', 'transfer', 50000, 1, 2),
    ]);
    expect(s).toEqual({
      income: 120000,
      spending: 30000,
      saved: 90000,
      savingsRate: 75,
      incomeCount: 2,
    });
  });

  it('gives no savings rate without income, and a negative one when overspent', () => {
    expect(summarise([f('2026-04-03', 'expense', 100, 1)]).savingsRate).toBeNull();
    expect(
      summarise([f('2026-04-01', 'income', 100, 1), f('2026-04-02', 'expense', 150, 1)])
        .savingsRate,
    ).toBe(-50);
  });

  it('is all zero for transfers only', () => {
    expect(summarise([f('2026-04-04', 'transfer', 50000, 1, 2)])).toEqual({
      income: 0,
      spending: 0,
      saved: 0,
      savingsRate: null,
      incomeCount: 0,
    });
  });
});
