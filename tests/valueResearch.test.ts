import { describe, expect, it } from 'vitest';
import { moneyMoved } from '@/lib/domain/holdings';
import {
  NOT_VR,
  guessAssetClass,
  parseValueResearch,
  parseVrDate,
} from '@/lib/domain/valueResearch';
import { readXls, type Cell, type Sheet } from '@/lib/xls';
import { writeXls } from './helpers/xlsWriter';

/** Laid out like a Value Research download. Every name, number and ISIN is invented. */

const BANNER: Cell[][] = [
  ['Name: Sample Owner'],
  [],
  ['TRANSACTION HISTORY as on 30-Sep-2026'],
  [],
];

function funds(rows: Cell[][], total?: number): Sheet {
  const sum = rows.reduce((s, r) => s + Math.round(Number(r[4]) * 100), 0) / 100;
  return {
    name: 'Mutual Funds & SIFs',
    rows: [
      ...BANNER,
      [
        'Transaction Date',
        'Scheme Name',
        'Folio Number',
        'Transaction Type',
        'Amount',
        'Units',
        'NAV',
        'Balance Units',
        'Market Value',
        'ISIN',
      ],
      ...rows,
      ['Mutual Funds / SIFs Total', null, null, null, total ?? sum],
    ],
  };
}

function stocks(rows: Cell[][]): Sheet {
  const sum = rows.reduce((s, r) => s + Math.round(Number(r[4]) * 100), 0) / 100;
  return {
    name: 'Stocks & ETFs',
    rows: [
      ...BANNER,
      [
        'Transaction Date',
        'Stock/ETF Name',
        'Demat A/c',
        'Transaction Type',
        'Amount',
        'Quantity',
        'Price',
        'Brokerage',
        'Balance Quantity',
        'Market Value',
        'ISIN',
      ],
      ...rows,
      ['Stocks & ETFs Total', null, null, null, sum],
    ],
  };
}

const FLEXI = 'INF000AA0011';
const fund = (date: string, type: string, amount: number, units: number, nav: number): Cell[] => [
  date,
  'Meridian Flexi Cap Fund Direct-Growth',
  '1234567/89',
  type,
  amount,
  units,
  nav,
  '--',
  '--',
  FLEXI,
];

describe('parseValueResearch', () => {
  it('reads buys and sells, oldest first, with stamp duty as the charge', () => {
    const { rows, skipped, problems } = parseValueResearch([
      funds([
        // Newest first, as in the download.
        fund('10-Jun-25', 'Sell/Redemption', -2100, -40, 52.5),
        fund('07-Apr-25', 'Investment in fund', 5000, 99.995, 50.0),
      ]),
    ]);
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.date, r.action, r.units, r.price, r.amount, r.fees])).toEqual([
      // ₹4,999.75 of units plus ₹0.25 stamp duty.
      ['2025-04-07', 'buy', '99.995', '50', 499975, 25],
      ['2025-06-10', 'sell', '40', '52.5', 210000, 0],
    ]);
    expect(rows[0]).toMatchObject({
      isin: FLEXI,
      type: 'mutual_fund',
      accountRef: '1234567/89',
      sheet: 'Mutual Funds & SIFs',
      line: 7,
      priceAdjusted: false,
    });
  });

  it('reads stocks and ETFs with brokerage on both sides', () => {
    const { rows } = parseValueResearch([
      stocks([
        [
          '02-Jan-26',
          'Kaveri Power Ltd',
          'DP-001',
          'Sell/Redemption',
          -2980,
          -10,
          300,
          '₹20.00',
          '--',
          '--',
          'INE000KP0011',
        ],
        [
          '19-May-25',
          'Saffron Nifty 50 ETF',
          'DP-001',
          'Investment in stock',
          2505,
          100,
          25,
          '₹5.00',
          '--',
          '--',
          'INF000SN0022',
        ],
      ]),
    ]);
    expect(rows.map((r) => [r.type, r.action, r.amount, r.fees, moneyMoved(r)])).toEqual([
      ['etf', 'buy', 250000, 500, 250500],
      ['stock', 'sell', 300000, 2000, 298000],
    ]);
  });

  it('works the price out from the amount when proceeds are more than units × price', () => {
    const { rows } = parseValueResearch([
      funds([fund('15-Mar-26', 'Sell/Redemption', -1004.57, -10, 54.7118)]),
    ]);
    const sell = rows[0]!;
    expect(sell.priceAdjusted).toBe(true);
    expect(sell.price).toBe('100.457');
    expect(sell.fees).toBe(0);
    expect(moneyMoved(sell)).toBe(100457);
  });

  it('rounds a worked-out price so the charges are never negative and money is exact', () => {
    const { rows } = parseValueResearch([
      funds([
        fund('01-Apr-25', 'Investment in fund', 100, 3, 40),
        fund('01-Mar-25', 'Investment in fund', 100, 3, 0),
      ]),
    ]);
    for (const r of rows) {
      expect(r.priceAdjusted).toBe(true);
      expect(r.fees).toBeGreaterThanOrEqual(0);
      expect(moneyMoved(r)).toBe(10000);
    }
    expect(rows[0]?.price).toBe('33.333333');
  });

  it('keeps same-day rows in the order they happened', () => {
    const { rows } = parseValueResearch([
      funds([
        fund('10-Jun-25', 'Investment in fund', 1000, 20, 50),
        fund('10-Jun-25', 'Sell/Redemption', -500, -10, 50),
        fund('07-Apr-25', 'Investment in fund', 500, 10, 50),
      ]),
    ]);
    expect(rows.map((r) => `${r.date} ${r.action}`)).toEqual([
      '2025-04-07 buy',
      '2025-06-10 sell',
      '2025-06-10 buy',
    ]);
  });

  it('merges both sheets by date', () => {
    const { rows } = parseValueResearch([
      funds([fund('07-Apr-25', 'Investment in fund', 500, 10, 50)]),
      stocks([
        [
          '01-Jan-25',
          'Kaveri Power Ltd',
          'DP-001',
          'Investment in stock',
          3000,
          10,
          300,
          '--',
          '--',
          '--',
          'INE000KP0011',
        ],
      ]),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2025-01-01', '2025-04-07']);
  });

  it('skips rows it cannot import and says why, but still checks the total', () => {
    const { rows, skipped, problems } = parseValueResearch([
      funds([
        fund('07-May-25', 'Dividend Payout', 120, 0, 0),
        fund('31-Feb-25', 'Investment in fund', 500, 10, 50),
        fund('07-Apr-25', 'Investment in fund', 500, 0, 50),
        [
          '07-Apr-25',
          'Harbor Gilt Fund',
          'F1',
          'Investment in fund',
          500,
          10,
          50,
          '--',
          '--',
          'NOT-AN-ISIN',
        ],
      ]),
    ]);
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
    expect(skipped.map((s) => [s.line, s.reason])).toEqual([
      [6, "“Dividend Payout” isn't imported. Add it by hand if you need it."],
      [7, "The date “31-Feb-25” can't be read."],
      [8, '7 Apr 2025 has no units. Add it by hand if you need it.'],
      [9, "The ISIN “NOT-AN-ISIN” isn't valid."],
    ]);
  });

  it('reports a total that does not match the rows', () => {
    const { problems } = parseValueResearch([
      funds([fund('07-Apr-25', 'Investment in fund', 500, 10, 50)], 600),
    ]);
    expect(problems).toEqual([
      "The totals in Mutual Funds & SIFs don't add up. Download the file again.",
    ]);
  });

  it('reports a workbook that is not a Value Research history', () => {
    expect(parseValueResearch([{ name: 'Sheet1', rows: [['Date', 'Amount']] }]).problems).toEqual([
      NOT_VR,
    ]);
    expect(parseValueResearch([]).problems).toEqual([NOT_VR]);
  });

  it('reads a real .xls built the same way', () => {
    const file = writeXls([funds([fund('29-Feb-24', 'Investment in fund', 500, 10, 50)])]);
    const { rows, problems } = parseValueResearch(readXls(file));
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount])).toEqual([['2024-02-29', 50000]]);
  });
});

describe('parseVrDate', () => {
  it('reads two- and four-digit years, any case, and Excel date numbers', () => {
    expect(parseVrDate('07-Apr-25')).toBe('2025-04-07');
    expect(parseVrDate('7-apr-2025')).toBe('2025-04-07');
    expect(parseVrDate('29-Feb-24')).toBe('2024-02-29');
    expect(parseVrDate(45754)).toBe('2025-04-07');
  });
  it('refuses dates that do not exist', () => {
    expect(parseVrDate('29-Feb-25')).toBeNull();
    expect(parseVrDate('07-Abc-25')).toBeNull();
    expect(parseVrDate('2025-04-07')).toBeNull();
    expect(parseVrDate(null)).toBeNull();
    expect(parseVrDate(0)).toBeNull();
  });
});

describe('guessAssetClass', () => {
  it('guesses from the name, then the type', () => {
    expect(guessAssetClass('Banyan Gold ETF', 'etf')).toBe('gold');
    expect(guessAssetClass('Saffron Silver ETF FoF', 'mutual_fund')).toBe('other');
    expect(guessAssetClass('Harbor Liquid Fund Direct-Growth', 'mutual_fund')).toBe('debt');
    expect(guessAssetClass('Meridian Corporate Bond Fund', 'mutual_fund')).toBe('debt');
    expect(guessAssetClass('Meridian Flexi Cap Fund', 'mutual_fund')).toBe('equity');
    expect(guessAssetClass('Kaveri Power Ltd', 'stock')).toBe('equity');
  });
});
