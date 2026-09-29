import { describe, expect, it } from 'vitest';
import { computeHolding, unitsAmount, type HoldingTxn } from '@/lib/domain/holdings';
import { fdValue, latestTwo, valueOn } from '@/lib/domain/valuation';

const txn = (id: number, date: string, action: HoldingTxn['action'], f: Partial<HoldingTxn>) => ({
  id,
  date,
  action,
  units: null,
  price: null,
  amount: null,
  fees: 0,
  splitFrom: null,
  splitTo: null,
  ...f,
});

const buy = (id: number, date: string, units: string, price: string) =>
  txn(id, date, 'buy', { units, price, amount: unitsAmount(units, price) });

const unitsAsset = {
  valuation: 'units' as const,
  interestRate: null,
  compounding: null,
  startDate: null,
  maturityDate: null,
};

describe('latestTwo', () => {
  const rows = [
    { date: '2026-09-25', price: '12' },
    { date: '2026-08-31', price: '10' },
    { date: '2026-09-30', price: '13' },
    { date: '2026-09-22', price: '11' },
  ];

  it('picks the latest on or before the date, and the one before', () => {
    expect(latestTwo(rows, '2026-09-28').map((r) => r?.price)).toEqual(['12', '11']);
    expect(latestTwo(rows, '2026-09-25').map((r) => r?.price)).toEqual(['12', '11']);
  });

  it('returns nulls when there is nothing that early', () => {
    expect(latestTwo(rows, '2026-08-31').map((r) => r?.price ?? null)).toEqual(['10', null]);
    expect(latestTwo(rows, '2026-01-01')).toEqual([null, null]);
  });
});

describe('valueOn, units', () => {
  const txns = [buy(1, '2026-01-10', '100', '50'), buy(2, '2026-03-10', '50', '62')];
  const holding = computeHolding(txns);

  it('values units at the latest price on or before the date', () => {
    const prices = [
      { date: '2026-09-22', price: '70' },
      { date: '2026-09-25', price: '72.5' },
      { date: '2026-10-01', price: '99' },
    ];
    const v = valueOn(unitsAsset, holding, txns, { prices, valuations: [] }, '2026-09-28');
    expect(v.value).toBe(1087500);
    expect(v.price).toEqual({ date: '2026-09-25', price: '72.5' });
    expect(v.stale).toBe(false);
    expect(v.sinceLast).toEqual({ change: 37500, previousValue: 1050000, since: '2026-09-22' });
  });

  it('falls back to the last buy price and flags it', () => {
    const v = valueOn(unitsAsset, holding, txns, { prices: [], valuations: [] }, '2026-09-28');
    expect(v.value).toBe(930000);
    expect(v.stale).toBe(true);
    expect(v.sinceLast).toBeNull();
  });

  it('has no change since last update with a single price', () => {
    const prices = [{ date: '2026-09-25', price: '70' }];
    const v = valueOn(unitsAsset, holding, txns, { prices, valuations: [] }, '2026-09-28');
    expect(v.sinceLast).toBeNull();
  });

  it('is worth nothing once sold', () => {
    const sold = [
      ...txns,
      txn(3, '2026-04-01', 'sell', { units: '150', price: '60', amount: 900000 }),
    ];
    const prices = [{ date: '2026-09-25', price: '70' }];
    expect(
      valueOn(unitsAsset, computeHolding(sold), sold, { prices, valuations: [] }, '2026-09-28')
        .value,
    ).toBe(0);
  });
});

describe('fdValue', () => {
  const fd = {
    principal: 10000000,
    rate: '7.10',
    compounding: 'quarterly' as const,
    start: '2025-01-01',
    maturity: '2027-01-01',
  };

  it('matches the section 6 vector: ₹1,00,000 at 7.10% quarterly for a year', () => {
    expect(fdValue({ ...fd, date: '2026-01-01' })).toBe(10729128);
  });

  it('does simple interest', () => {
    expect(fdValue({ ...fd, compounding: 'simple', date: '2026-01-01' })).toBe(10710000);
  });

  it('stops growing at maturity', () => {
    const atMaturity = fdValue({ ...fd, date: '2027-01-01' });
    expect(fdValue({ ...fd, date: '2028-06-30' })).toBe(atMaturity);
  });

  it('is the principal on or before the start date', () => {
    expect(fdValue({ ...fd, date: '2024-12-01' })).toBe(10000000);
  });

  it('treats missing compounding as quarterly', () => {
    expect(fdValue({ ...fd, compounding: null, date: '2026-01-01' })).toBe(10729128);
  });
});

describe('valueOn, fd and manual', () => {
  it('values an FD from its rate and start date', () => {
    const txns = [txn(1, '2025-01-01', 'deposit', { amount: 10000000 })];
    const asset = {
      valuation: 'fd' as const,
      interestRate: '7.10',
      compounding: 'quarterly' as const,
      startDate: '2025-01-01',
      maturityDate: '2027-01-01',
    };
    const v = valueOn(
      asset,
      computeHolding(txns),
      txns,
      { prices: [], valuations: [] },
      '2026-01-01',
    );
    expect(v.value).toBe(10729128);
  });

  const manual = { ...unitsAsset, valuation: 'manual' as const };
  const txns = [
    txn(1, '2024-04-10', 'deposit', { amount: 5000000 }),
    txn(2, '2025-04-10', 'deposit', { amount: 4000000 }),
  ];
  const holding = computeHolding(txns);

  it('uses the net amount invested with no statement', () => {
    expect(valueOn(manual, holding, txns, { prices: [], valuations: [] }, '2026-09-28').value).toBe(
      9000000,
    );
  });

  it('uses the last statement, plus deposits made after it', () => {
    const valuations = [
      { date: '2025-03-31', value: 5400000 },
      { date: '2026-03-31', value: 9900000 },
    ];
    expect(valueOn(manual, holding, txns, { prices: [], valuations }, '2026-09-28').value).toBe(
      9900000,
    );
    expect(valueOn(manual, holding, txns, { prices: [], valuations }, '2025-06-01').value).toBe(
      9400000,
    );
  });
});
