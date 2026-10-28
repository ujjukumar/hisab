import { describe, expect, it } from 'vitest';
import {
  classifySale,
  realisedLots,
  summariseGains,
  type SaleLot,
  type TaxAsset,
} from '@/lib/domain/capitalGains';
import { OversellError, unitsAmount, type HoldingTxn } from '@/lib/domain/holdings';

let nextId = 1;
const t = (date: string, action: HoldingTxn['action'], fields: Partial<HoldingTxn> = {}): HoldingTxn => ({
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
const trade = (date: string, action: 'buy' | 'sell', units: string, price: string, fees = 0) =>
  t(date, action, { units, price, amount: unitsAmount(units, price), fees: fees * 100 });

const stock: TaxAsset = { id: 1, name: 'Invented Steel', type: 'stock', assetClass: 'equity' };
const equityFund: TaxAsset = { id: 2, name: 'Invented Index Fund', type: 'mutual_fund', assetClass: 'equity' };
const debtFund = { type: 'mutual_fund', assetClass: 'debt' } as const;
const goldFund = { type: 'mutual_fund', assetClass: 'gold' } as const;
const goldEtf = { type: 'etf', assetClass: 'gold' } as const;
const gold = { type: 'gold', assetClass: 'gold' } as const;

describe('classifySale', () => {
  it('treats exactly 12 months as short-term and a day more as long-term for equity', () => {
    expect(classifySale(stock, '2024-01-15', '2025-01-15')).toEqual({ term: 'short', kind: 'equity_short', rate: 20 });
    expect(classifySale(stock, '2024-01-15', '2025-01-16')).toEqual({ term: 'long', kind: 'equity_long', rate: 12.5 });
  });

  it('uses the old rates for sales before 23 Jul 2024', () => {
    expect(classifySale(equityFund, '2024-01-10', '2024-07-22').rate).toBe(15);
    expect(classifySale(equityFund, '2024-01-10', '2024-07-23').rate).toBe(20);
    expect(classifySale(equityFund, '2022-01-10', '2024-07-22')).toEqual({ term: 'long', kind: 'equity_long', rate: 10 });
    expect(classifySale(equityFund, '2022-01-10', '2024-07-23').rate).toBe(12.5);
  });

  it('counts a leap-day buy as held 12 months on 28 Feb', () => {
    expect(classifySale(stock, '2024-02-29', '2025-02-28').term).toBe('short');
    expect(classifySale(stock, '2024-02-29', '2025-03-01').term).toBe('long');
  });

  it('leaves equity bought before 1 Feb 2018 out when long-term', () => {
    expect(classifySale(stock, '2018-01-31', '2025-06-01').kind).toBe('grandfathered');
    expect(classifySale(stock, '2018-02-01', '2025-06-01').kind).toBe('equity_long');
  });

  it('taxes debt funds bought from 1 Apr 2023 at slab rates however long they are held', () => {
    expect(classifySale(debtFund, '2023-04-01', '2026-06-01')).toEqual({ term: 'short', kind: 'slab', rate: null });
    expect(classifySale(debtFund, '2023-03-31', '2026-06-01')).toEqual({ term: 'long', kind: 'other_long', rate: 12.5 });
    expect(classifySale(debtFund, '2023-03-31', '2025-03-31').kind).toBe('slab');
  });

  it('flags long-term non-equity sales before 23 Jul 2024 for indexation', () => {
    expect(classifySale(debtFund, '2020-01-01', '2024-06-01').kind).toBe('indexation');
    expect(classifySale(gold, '2020-01-01', '2024-06-01').kind).toBe('indexation');
    expect(classifySale(gold, '2022-01-01', '2024-06-01').kind).toBe('slab');
  });

  it('stops treating gold funds bought from Apr 2023 as slab-rate from 1 Apr 2025', () => {
    expect(classifySale(goldFund, '2023-05-01', '2025-03-31').kind).toBe('slab');
    expect(classifySale(goldFund, '2023-05-01', '2025-06-01')).toEqual({ term: 'long', kind: 'other_long', rate: 12.5 });
  });

  it('uses 12 months for gold ETFs and 24 for gold itself', () => {
    expect(classifySale(goldEtf, '2022-06-01', '2025-05-01').kind).toBe('other_long');
    expect(classifySale(goldEtf, '2024-04-01', '2025-03-01').kind).toBe('slab');
    expect(classifySale(goldEtf, '2024-09-01', '2025-09-01').kind).toBe('slab');
    expect(classifySale(goldEtf, '2025-04-01', '2026-04-02').kind).toBe('other_long');
    expect(classifySale(gold, '2023-06-01', '2025-06-01').kind).toBe('slab');
    expect(classifySale(gold, '2023-06-01', '2025-06-02').kind).toBe('other_long');
  });
});

describe('realisedLots', () => {
  it('matches a sale to the oldest lots first, with fees in cost and proceeds', () => {
    const { lots } = realisedLots(stock, [
      trade('2024-01-10', 'buy', '100', '50', 20),
      trade('2025-03-10', 'buy', '50', '62', 10),
      trade('2025-06-10', 'sell', '120', '70', 24),
    ]);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toMatchObject({ bought: '2024-01-10', cost: 502000, proceeds: 698000, gain: 196000, kind: 'equity_long' });
    expect(lots[0]!.units.toString()).toBe('100');
    expect(lots[1]).toMatchObject({ bought: '2025-03-10', cost: 124400, proceeds: 139600, gain: 15200, kind: 'equity_short' });
    expect(lots[0]!.proceeds + lots[1]!.proceeds).toBe(840000 - 2400);
  });

  it('carries the rest of a part-sold lot into the next sale', () => {
    const { lots } = realisedLots(stock, [
      trade('2025-01-10', 'buy', '3', '100'),
      trade('2025-02-10', 'sell', '1', '120'),
      trade('2025-03-10', 'sell', '2', '90'),
    ]);
    expect(lots.map((l) => l.cost)).toEqual([10000, 20000]);
    expect(lots.map((l) => l.gain)).toEqual([2000, -2000]);
  });

  it('scales lots on a split and keeps their cost and date', () => {
    const { lots } = realisedLots(stock, [
      trade('2024-01-10', 'buy', '10', '1000'),
      t('2024-06-01', 'split', { splitFrom: 1, splitTo: 5 }),
      trade('2025-03-01', 'sell', '50', '250'),
    ]);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ bought: '2024-01-10', cost: 1000000, proceeds: 1250000, gain: 250000 });
  });

  it('sells everything and has nothing left over', () => {
    const { lots } = realisedLots(equityFund, [
      trade('2025-04-10', 'buy', '33.333', '30'),
      trade('2025-05-10', 'buy', '16.667', '30'),
      trade('2025-09-10', 'sell', '50', '31'),
    ]);
    expect(lots.reduce((s, l) => s + l.proceeds, 0)).toBe(155000);
    expect(lots.reduce((s, l) => s + l.cost, 0)).toBe(150000);
  });

  it('returns nothing for zero units or no sales', () => {
    expect(realisedLots(stock, [trade('2025-01-10', 'buy', '0', '10')]).lots).toEqual([]);
    expect(realisedLots(stock, []).lots).toEqual([]);
  });

  it('fails on selling more than held', () => {
    expect(() =>
      realisedLots(stock, [trade('2025-01-10', 'buy', '5', '10'), trade('2025-02-10', 'sell', '6', '10')]),
    ).toThrow(OversellError);
  });

  it('keeps intraday results apart', () => {
    const { lots, intraday } = realisedLots(stock, [
      t('2025-05-02', 'intraday', { units: '10', price: '100', amount: 5000, fees: 300 }),
    ]);
    expect(lots).toEqual([]);
    expect(intraday).toEqual([{ assetId: 1, date: '2025-05-02', amount: 4700 }]);
  });
});

const lot = (kind: SaleLot['kind'], rate: number | null, gain: number, term: SaleLot['term']): SaleLot => ({
  assetId: 1,
  saleTxnId: 1,
  bought: '2024-01-01',
  sold: '2025-06-01',
  units: {} as SaleLot['units'],
  cost: 0,
  proceeds: gain,
  gain,
  term,
  kind,
  rate,
});

describe('summariseGains', () => {
  it('sets a short-term loss against short-term equity first, then slab, then long-term', () => {
    const s = summariseGains([
      lot('equity_short', 20, 10000, 'short'),
      lot('slab', null, 5000, 'short'),
      lot('equity_long', 12.5, 50000, 'long'),
      lot('equity_short', 20, -18000, 'short'),
      lot('slab', null, -4000, 'short'),
    ]);
    expect(s.slab).toBe(0);
    expect(s.special).toEqual([{ kind: 'equity_long', rate: 12.5, gain: 43000 }]);
    expect(s.shortLossLeft).toBe(0);
  });

  it('sets a long-term loss only against long-term gains and keeps what is left', () => {
    const s = summariseGains([
      lot('equity_short', 20, 10000, 'short'),
      lot('other_long', 12.5, 3000, 'long'),
      lot('equity_long', 12.5, -8000, 'long'),
    ]);
    expect(s.special).toEqual([{ kind: 'equity_short', rate: 20, gain: 10000 }]);
    expect(s.longLossLeft).toBe(5000);
  });

  it('keeps indexation and grandfathered sales out', () => {
    const s = summariseGains([lot('indexation', null, 9000, 'long'), lot('grandfathered', null, 7000, 'long')]);
    expect(s.special).toEqual([]);
    expect(s.leftOut).toHaveLength(2);
  });

  it('orders special gains by rate, highest first', () => {
    const s = summariseGains([
      lot('equity_long', 10, 1000, 'long'),
      lot('equity_long', 12.5, 1000, 'long'),
      lot('equity_short', 15, 1000, 'short'),
      lot('equity_short', 20, 1000, 'short'),
    ]);
    expect(s.special.map((g) => g.rate)).toEqual([20, 15, 12.5, 10]);
  });
});
