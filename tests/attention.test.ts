import { describe, expect, it } from 'vitest';
import { attentionItems, STALE_PRICE_DAYS, type AttentionInput } from '@/lib/domain/attention';

/** All sample data here is invented. */
const base: AttentionInput = {
  today: '2026-09-20',
  month: '2026-09',
  isCurrentMonth: true,
  budgets: { rows: [] },
  accounts: [],
  holdings: [],
  prices: { lastOn: '2026-09-19', ok: true, auto: true },
};

const input = (over: Partial<AttentionInput>): AttentionInput => ({ ...base, ...over });
const keys = (over: Partial<AttentionInput>) => attentionItems(input(over)).map((i) => i.key);
const only = (over: Partial<AttentionInput>) => {
  const items = attentionItems(input(over));
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe('attentionItems', () => {
  it('says nothing when nothing is wrong', () => {
    expect(attentionItems(base)).toEqual([]);
  });

  it('lists investment concerns before money ones', () => {
    expect(
      keys({
        prices: { lastOn: null, ok: true, auto: true },
        holdings: [{ name: 'Index fund', stale: true, sold: false }],
        budgets: { rows: [{ name: 'Food', over: true }] },
        accounts: [{ name: 'Savings', type: 'bank', balance: -100, archived: false }],
      }),
    ).toEqual(['prices', 'no-price', 'budgets', 'overdrawn']);
  });
});

describe('price signals', () => {
  it('says nothing when the owner has switched automatic prices off', () => {
    expect(keys({ prices: { lastOn: null, ok: false, auto: false } })).toEqual([]);
  });

  it('flags prices that have never been updated', () => {
    expect(only({ prices: { lastOn: null, ok: true, auto: true } }).text).toBe(
      'Prices have never been updated',
    );
  });

  it('flags an update that did not finish, however recent', () => {
    expect(only({ prices: { lastOn: '2026-09-20', ok: false, auto: true } }).text).toBe(
      'The price update on 20 Sep 2026 did not finish',
    );
  });

  it('stays quiet on the day the threshold is reached, and speaks up after it', () => {
    const onThreshold = '2026-09-16'; // exactly STALE_PRICE_DAYS before today
    expect(STALE_PRICE_DAYS).toBe(4);
    expect(keys({ prices: { lastOn: onThreshold, ok: true, auto: true } })).toEqual([]);
    expect(only({ prices: { lastOn: '2026-09-15', ok: true, auto: true } }).text).toBe(
      'Prices were last updated on 15 Sep 2026',
    );
  });

  it('never has more than one thing to say about prices', () => {
    expect(keys({ prices: { lastOn: '2026-01-01', ok: false, auto: true } })).toEqual(['prices']);
  });
});

describe('holdings with no price', () => {
  it('names the holding when there is only one', () => {
    const item = only({
      holdings: [
        { name: 'Kaveri Power', stale: true, sold: false },
        { name: 'Priced fund', stale: false, sold: false },
      ],
    });
    expect(item.text).toBe('Kaveri Power has no price yet');
    expect(item.action).toBe('Add a price');
    expect(item.href).toBe('/investments');
  });

  it('counts them when there are several', () => {
    const item = only({
      holdings: [
        { name: 'Kaveri Power', stale: true, sold: false },
        { name: 'Deccan Mills', stale: true, sold: false },
      ],
    });
    expect(item.text).toBe('2 holdings have no price yet');
    expect(item.action).toBe('Add prices');
  });

  it('ignores holdings that have been sold', () => {
    expect(keys({ holdings: [{ name: 'Kaveri Power', stale: true, sold: true }] })).toEqual([]);
  });
});

describe('budgets over their limit', () => {
  it('names the category when only one is over', () => {
    const item = only({
      budgets: { rows: [{ name: 'Food', over: true }, { name: 'Travel', over: false }] },
    });
    expect(item.text).toBe('Food is over its budget');
    expect(item.tone).toBe('neg');
    expect(item.href).toBe('/money/budgets');
  });

  it('counts them when several are over', () => {
    expect(
      only({ budgets: { rows: [{ name: 'Food', over: true }, { name: 'Travel', over: true }] } })
        .text,
    ).toBe('2 budgets are over');
  });

  it('keeps the month in the link when an older month is showing', () => {
    expect(
      only({
        isCurrentMonth: false,
        month: '2026-07',
        budgets: { rows: [{ name: 'Food', over: true }] },
      }).href,
    ).toBe('/money/budgets?month=2026-07');
  });
});

describe('accounts below zero', () => {
  const account = (over: Partial<AttentionInput['accounts'][number]>) => ({
    name: 'Savings',
    type: 'bank',
    balance: -5000,
    archived: false,
    ...over,
  });

  it('names the account when only one is below zero', () => {
    const item = only({ accounts: [account({}), account({ name: 'Current', balance: 1000 })] });
    expect(item.text).toBe('Savings is below zero');
    expect(item.tone).toBe('');
    expect(item.href).toBe('/money/accounts');
  });

  it('counts them when several are below zero', () => {
    expect(
      only({ accounts: [account({}), account({ name: 'Wallet', type: 'wallet' })] }).text,
    ).toBe('2 accounts are below zero');
  });

  it('leaves cards alone, because a negative balance there is money owed', () => {
    expect(keys({ accounts: [account({ name: 'Credit card', type: 'card' })] })).toEqual([]);
  });

  it('leaves archived accounts alone', () => {
    expect(keys({ accounts: [account({ archived: true })] })).toEqual([]);
  });

  it('does not flag a balance of exactly zero', () => {
    expect(keys({ accounts: [account({ balance: 0 })] })).toEqual([]);
  });
});
