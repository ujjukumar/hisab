import { describe, expect, it } from 'vitest';
import type { Asset } from '@/lib/db/schema';
import { unitsAmount, type HoldingTxn } from '@/lib/domain/holdings';
import type { PortfolioData } from '@/lib/domain/portfolio';
import {
  feedAssets,
  isDue,
  parseAmfiNav,
  parseBhavcopy,
  pastPriceNeeds,
  pricesFor,
} from '@/lib/domain/priceFeeds';

/** PLAN section 11, phase 8. The layouts match AMFI's and NSE's files; every name and number is invented. */

describe('parseAmfiNav', () => {
  it('reads the latest-NAV list, skipping headings, blank lines and N.A.', () => {
    const text = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
      '',
      'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)',
      '',
      'Meridian Mutual Fund',
      '',
      '100001;INF000MF0012;-;Meridian Flexi Cap Fund - Direct Plan - Growth;Direct;Growth;123.4500;26-Sep-2025',
      '100002;INF000MF0020;INF000MF0038;Meridian Flexi Cap Fund - Direct Plan - IDCW;Direct;IDCW;21.0700;26-Sep-2025',
      '100003;INF000MF0046;-;Meridian Closed Fund;Direct;Growth;N.A.;26-Sep-2025',
      '100004;inf000ho0017;-;Harbor Overnight Fund;Direct;Growth;1250.1;29-Feb-2024',
    ].join('\r\n');
    const map = parseAmfiNav(text);
    expect(Object.fromEntries(map)).toEqual({
      INF000MF0012: { date: '2025-09-26', price: '123.45' },
      INF000MF0020: { date: '2025-09-26', price: '21.07' },
      INF000MF0038: { date: '2025-09-26', price: '21.07' },
      INF000HO0017: { date: '2024-02-29', price: '1250.1' },
    });
  });

  it('reads the history report, whose columns are in a different order', () => {
    const text = [
      'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
      '',
      'Saffron Mutual Fund',
      '200001;Saffron Midcap Fund - Direct Growth;Direct;Growth;INF000SM0025;;88.1234;30-Jun-2025',
    ].join('\n');
    expect(Object.fromEntries(parseAmfiNav(text))).toEqual({
      INF000SM0025: { date: '2025-06-30', price: '88.1234' },
    });
  });

  it('returns nothing for a page that is not a NAV list', () => {
    expect(parseAmfiNav('<!DOCTYPE html><html>Service unavailable</html>').size).toBe(0);
    expect(parseAmfiNav('').size).toBe(0);
  });

  it('refuses zero, negative and over-precise NAVs', () => {
    const text = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
      '1;INF000AA0011;-;A;0.0000;26-Sep-2025',
      '2;INF000AA0029;-;B;-5.10;26-Sep-2025',
      '3;INF000AA0037;-;C;10.1234567;26-Sep-2025',
      '4;INF000AA0045;-;D;10.5;31-Sep-2025',
    ].join('\n');
    expect(parseAmfiNav(text).size).toBe(0);
  });
});

describe('parseBhavcopy', () => {
  it('reads the UDiFF format and prefers the EQ series', () => {
    const csv = [
      'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,OpnPric,ClsPric,LastPric',
      '2025-09-26,2025-09-26,CM,NSE,STK,1,INE000KP0011,KAVERI,BE,400,401.00,401',
      '2025-09-26,2025-09-26,CM,NSE,STK,1,INE000KP0011,KAVERI,EQ,410,412.35,412',
      '2025-09-26,2025-09-26,CM,NSE,STK,2,INE000SF0019,SAHYADRI,EQ,99,98.05,98',
      '2025-09-26,2025-09-26,CM,NSE,STK,2,INE000SF0019,SAHYADRI,BL,99,97.00,97',
      '2025-09-26,2025-09-26,CM,NSE,STK,3,INF000BN0015,BANYANNIFTY,EQ,250,251.2,251',
      '2025-09-26,2025-09-26,CM,NSE,STK,4,,NOISIN,EQ,1,1,1',
      '',
    ].join('\r\n');
    expect(Object.fromEntries(parseBhavcopy(csv))).toEqual({
      INE000KP0011: { date: '2025-09-26', price: '412.35' },
      INE000SF0019: { date: '2025-09-26', price: '98.05' },
      INF000BN0015: { date: '2025-09-26', price: '251.2' },
    });
  });

  it('reads the older format', () => {
    const csv = [
      'SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN,',
      'KAVERI,EQ,300,310,295,305.5,305,299,1000,305000,28-JUN-2024,40,INE000KP0011,',
    ].join('\n');
    expect(Object.fromEntries(parseBhavcopy(csv))).toEqual({
      INE000KP0011: { date: '2024-06-28', price: '305.5' },
    });
  });

  it('returns nothing without the columns it needs', () => {
    expect(parseBhavcopy('Symbol,Close\nKAVERI,10').size).toBe(0);
  });
});

describe('isDue', () => {
  it('checks once a calendar day', () => {
    expect(isDue(null, '2026-10-01')).toBe(true);
    expect(isDue('2026-09-30', '2026-10-01')).toBe(true);
    expect(isDue('2026-10-01', '2026-10-01')).toBe(false);
    expect(isDue('2024-12-31', '2025-01-01')).toBe(true);
  });
});

const asset = (
  id: number,
  type: Asset['type'],
  symbol: string | null,
  valuation: Asset['valuation'] = 'units',
): Asset => ({
  id,
  name: `Invented ${id}`,
  type,
  assetClass: 'equity',
  valuation,
  symbol,
  accountRef: null,
  interestRate: null,
  compounding: null,
  startDate: null,
  maturityDate: null,
  note: null,
  archived: 0,
  createdAt: '',
  updatedAt: '',
});

const trade = (
  id: number,
  assetId: number,
  date: string,
  action: 'buy' | 'sell',
  units: string,
): HoldingTxn & { assetId: number } => ({
  id,
  assetId,
  date,
  action,
  units,
  price: '10',
  amount: unitsAmount(units, '10'),
  fees: 0,
  splitFrom: null,
  splitTo: null,
});

describe('feedAssets and pricesFor', () => {
  const assets = [
    asset(1, 'mutual_fund', ' inf000mf0012 '),
    asset(2, 'stock', 'INE000KP0011'),
    asset(3, 'etf', 'INF000BN0015'),
    asset(4, 'mutual_fund', 'MERIDIAN'),
    asset(5, 'gold', 'INF000GD0010'),
    asset(6, 'mutual_fund', 'INF000MF0020', 'manual'),
    asset(7, 'stock', null),
  ];

  it('links only unit-priced funds, stocks and ETFs whose symbol is an ISIN', () => {
    expect(feedAssets(assets)).toEqual([
      { id: 1, isin: 'INF000MF0012', feed: 'amfi' },
      { id: 2, isin: 'INE000KP0011', feed: 'nse' },
      { id: 3, isin: 'INF000BN0015', feed: 'nse' },
    ]);
  });

  it('pairs each linked investment with its price, leaving out ISINs the file lacks', () => {
    const map = new Map([
      ['INF000MF0012', { date: '2025-09-26', price: '123.45' }],
      ['INE000ZZ0019', { date: '2025-09-26', price: '1' }],
    ]);
    expect(pricesFor(feedAssets(assets), map)).toEqual([
      { assetId: 1, date: '2025-09-26', price: '123.45' },
    ]);
  });
});

describe('pastPriceNeeds', () => {
  const data: PortfolioData = {
    assets: [
      asset(1, 'mutual_fund', 'INF000MF0012'),
      asset(2, 'stock', 'INE000KP0011'),
      asset(3, 'mutual_fund', null),
    ],
    txns: [
      trade(1, 1, '2024-01-10', 'buy', '10'),
      trade(2, 2, '2024-02-05', 'buy', '5'),
      trade(3, 2, '2024-03-20', 'sell', '5'),
      trade(4, 3, '2023-06-01', 'buy', '1'),
    ],
    prices: [
      // A price three days before the February month-end covers it (29 Feb, leap year).
      { assetId: 1, date: '2024-02-26', price: '11' },
      { assetId: 1, date: '2024-03-10', price: '11' },
    ],
    valuations: [],
  };

  it('lists month-ends where a held, linked investment has no price in the week before', () => {
    const needs = pastPriceNeeds(data, '2024-04');
    expect(needs.map((n) => [n.date, n.linked.map((a) => a.id)])).toEqual([
      ['2024-01-31', [1]],
      ['2024-02-29', [2]],
      ['2024-03-31', [1]],
      ['2024-04-30', [1]],
    ]);
  });

  it('is empty when nothing is linked or nothing was bought', () => {
    expect(pastPriceNeeds({ ...data, txns: [] }, '2024-04')).toEqual([]);
    expect(pastPriceNeeds({ ...data, assets: [asset(3, 'mutual_fund', null)] }, '2024-04')).toEqual(
      [],
    );
  });

  it('crosses the year end', () => {
    const late: PortfolioData = {
      ...data,
      txns: [trade(1, 1, '2024-12-02', 'buy', '1')],
      prices: [],
    };
    expect(pastPriceNeeds(late, '2025-01').map((n) => n.date)).toEqual([
      '2024-12-31',
      '2025-01-31',
    ]);
  });
});
