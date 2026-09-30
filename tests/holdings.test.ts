import { describe, expect, it } from 'vitest';
import {
  byDateThenId,
  computeHolding,
  isSold,
  linkedMoneyRow,
  moneyMoved,
  netInvested,
  OversellError,
  unitsAmount,
  type HoldingTxn,
} from '@/lib/domain/holdings';

let nextId = 1;
const t = (
  date: string,
  action: HoldingTxn['action'],
  fields: Partial<HoldingTxn> = {},
): HoldingTxn => ({
  id: nextId++,
  date,
  action,
  units: null,
  price: null,
  amount: null,
  fees: 0,
  splitFrom: null,
  splitTo: null,
  ...fields,
});

/** A buy or sell with its amount worked out the way the app stores it. */
const trade = (date: string, action: 'buy' | 'sell', units: string, price: string, fees = 0) =>
  t(date, action, { units, price, amount: unitsAmount(units, price), fees: fees * 100 });

describe('computeHolding', () => {
  it('matches the section 6 vector', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '100', '50', 20),
      trade('2026-02-10', 'buy', '50', '62', 10),
      trade('2026-03-10', 'sell', '60', '70', 15),
    ]);
    expect(h.units.toString()).toBe('90');
    expect(h.cost).toBe(487800);
    expect(h.realised).toBe(93300);
    expect(h.outflows).toBe(813000);
    expect(h.inflows).toBe(418500);
  });

  it('works in date order whatever order the rows arrive in', () => {
    const sell = trade('2026-03-10', 'sell', '60', '70', 15);
    const h = computeHolding([sell, trade('2026-01-10', 'buy', '100', '50', 20)]);
    expect(h.units.toString()).toBe('40');
    expect(h.firstDate).toBe('2026-01-10');
  });

  it('sells everything down to zero cost', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '10.5', '100'),
      trade('2026-02-10', 'sell', '10.5', '120'),
    ]);
    expect(h.units.isZero()).toBe(true);
    expect(h.cost).toBe(0);
    expect(h.realised).toBe(21000);
    expect(isSold(h, 'units')).toBe(true);
  });

  it('rejects selling more than is held on that date', () => {
    const buy = trade('2026-01-10', 'buy', '100', '50');
    const early = trade('2026-01-09', 'sell', '1', '50');
    expect(() => computeHolding([buy, early])).toThrow(OversellError);
    expect(() => computeHolding([buy, trade('2026-02-01', 'sell', '100.5', '50')])).toThrow(
      'You only hold 100 units on that date.',
    );
  });

  it('multiplies units on a split and leaves cost alone', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '10', '500'),
      t('2026-02-01', 'split', { splitFrom: 1, splitTo: 5 }),
    ]);
    expect(h.units.toString()).toBe('50');
    expect(h.cost).toBe(500000);
  });

  it('adds bonus units at price 0 without changing cost or the fallback price', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '10', '500'),
      trade('2026-02-01', 'buy', '10', '0'),
    ]);
    expect(h.units.toString()).toBe('20');
    expect(h.cost).toBe(500000);
    expect(h.lastBuyPrice).toBe('500');
  });

  it('adds fees to cost and takes them off sale proceeds', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '10', '100', 5),
      t('2026-01-20', 'fee', { amount: 300 }),
      trade('2026-02-01', 'sell', '5', '100', 5),
    ]);
    // Cost 1,008 for 10 units; half removed is 504; proceeds 495.
    expect(h.cost).toBe(50400);
    expect(h.realised).toBe(-900);
    expect(h.outflows).toBe(100800);
  });

  it('keeps dividends as income, not cost', () => {
    const h = computeHolding([
      trade('2026-01-10', 'buy', '10', '100'),
      t('2026-03-01', 'dividend', { amount: 6400 }),
    ]);
    expect(h.income).toBe(6400);
    expect(h.cost).toBe(100000);
    expect(h.flows).toEqual([
      { date: '2026-01-10', amount: -100000 },
      { date: '2026-03-01', amount: 6400 },
    ]);
  });

  it('tracks deposits and withdrawals for manual assets, with growth as realised gain', () => {
    const deposit = t('2024-04-10', 'deposit', { amount: 5000000 });
    const part = computeHolding([deposit, t('2025-01-10', 'withdrawal', { amount: 1000000 })]);
    expect(part.cost).toBe(4000000);
    expect(isSold(part, 'manual')).toBe(false);

    const all = computeHolding([deposit, t('2026-01-10', 'withdrawal', { amount: 5600000 })]);
    expect(all.cost).toBe(0);
    expect(all.realised).toBe(600000);
    expect(isSold(all, 'manual')).toBe(true);
  });

  it('records the units held after each transaction', () => {
    const a = trade('2026-01-10', 'buy', '100', '50');
    const b = trade('2026-02-10', 'sell', '30', '55');
    const h = computeHolding([a, b]);
    expect(h.unitsAfter.get(a.id)?.toString()).toBe('100');
    expect(h.unitsAfter.get(b.id)?.toString()).toBe('70');
  });

  it('treats an asset with no transactions as sold', () => {
    const h = computeHolding([]);
    expect(isSold(h, 'units')).toBe(true);
    expect(h.firstDate).toBeNull();
  });
});

describe('byDateThenId', () => {
  it('orders by date, then id', () => {
    const rows = [
      { id: 3, date: '2026-01-02' },
      { id: 2, date: '2026-01-01' },
      { id: 1, date: '2026-01-02' },
    ];
    expect(rows.sort(byDateThenId).map((r) => r.id)).toEqual([2, 1, 3]);
  });
});

describe('unitsAmount', () => {
  it('rounds to the nearest paisa', () => {
    expect(unitsAmount('1660.1234', '231.4567')).toBe(38424668);
    expect(unitsAmount('0', '100')).toBe(0);
  });
});

describe('moneyMoved', () => {
  it('adds fees to what was paid and takes them off what was received', () => {
    expect(moneyMoved(trade('2026-01-01', 'buy', '10', '100', 20))).toBe(102000);
    expect(moneyMoved(trade('2026-01-01', 'sell', '10', '100', 20))).toBe(98000);
    expect(moneyMoved(t('2026-01-01', 'deposit', { amount: 5000 }))).toBe(5000);
    expect(moneyMoved(t('2026-01-01', 'dividend', { amount: 640 }))).toBe(640);
  });

  it('is zero for bonus units and null for a split', () => {
    expect(moneyMoved(trade('2026-01-01', 'buy', '10', '0'))).toBe(0);
    expect(moneyMoved(t('2026-01-01', 'split', { splitFrom: 1, splitTo: 5 }))).toBeNull();
  });
});

describe('linkedMoneyRow', () => {
  it('pays buys, deposits and fees from the account and puts sale money into it', () => {
    expect(linkedMoneyRow(trade('2026-01-01', 'buy', '10', '100', 20), 3, null)).toEqual({
      type: 'transfer',
      amount: 102000,
      accountId: 3,
      toAccountId: null,
      categoryId: null,
    });
    expect(linkedMoneyRow(t('2026-01-01', 'fee', { amount: 500 }), 3, null)).toMatchObject({
      accountId: 3,
      toAccountId: null,
    });
    expect(linkedMoneyRow(trade('2026-01-01', 'sell', '10', '100', 20), 3, null)).toEqual({
      type: 'transfer',
      amount: 98000,
      accountId: null,
      toAccountId: 3,
      categoryId: null,
    });
  });

  it('records dividends and interest as income in the category', () => {
    expect(linkedMoneyRow(t('2026-01-01', 'dividend', { amount: 640 }), 3, 9)).toEqual({
      type: 'income',
      amount: 640,
      accountId: 3,
      toAccountId: null,
      categoryId: 9,
    });
  });
});

describe('netInvested', () => {
  it('counts buys and deposits in, sells and withdrawals out, and ignores income and splits', () => {
    const txns = [
      trade('2026-01-01', 'buy', '10', '100', 20),
      t('2026-02-01', 'deposit', { amount: 5000 }),
      trade('2026-03-01', 'sell', '4', '120', 10),
      t('2026-04-01', 'withdrawal', { amount: 1000 }),
      t('2026-05-01', 'dividend', { amount: 640 }),
      t('2026-06-01', 'split', { splitFrom: 1, splitTo: 2 }),
    ];
    // ₹1,020 + ₹50 − (₹480 − ₹10) − ₹10.
    expect(netInvested(txns)).toBe(102000 + 5000 - 47000 - 1000);
  });

  it('is zero with nothing, and negative when more came out than went in', () => {
    expect(netInvested([])).toBe(0);
    expect(netInvested([trade('2026-01-01', 'sell', '1', '500')])).toBe(-50000);
  });
});
