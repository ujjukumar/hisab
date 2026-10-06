import { describe, expect, it } from 'vitest';
import type { Asset } from '@/lib/db/schema';
import { unitsAmount, type HoldingTxn } from '@/lib/domain/holdings';
import {
  investmentPeriodRows,
  linePoints,
  performanceSeries,
  sampleHistoryDates,
  seriesCadence,
  periodRows,
  periodStart,
  periodTotals,
} from '@/lib/domain/performance';
import { buildPortfolio, type PortfolioData } from '@/lib/domain/portfolio';

const asset = (id: number, name: string): Asset => ({
  id,
  name,
  type: 'mutual_fund',
  assetClass: 'equity',
  valuation: 'units',
  symbol: null,
  navStartDate: null,
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
  price: string,
): HoldingTxn & { assetId: number } => ({
  id,
  assetId,
  date,
  action,
  units,
  price,
  amount: unitsAmount(units, price),
  fees: 0,
  splitFrom: null,
  splitTo: null,
});

// Invented funds. Meridian: 100 units at ₹10, 50 more at ₹12. Banyan: bought and sold in a month.
const data: PortfolioData = {
  assets: [asset(1, 'Meridian Flexi Fund'), asset(2, 'Banyan Value Fund')],
  txns: [
    trade(1, 1, '2025-01-15', 'buy', '100', '10'),
    trade(2, 2, '2025-01-20', 'buy', '10', '100'),
    trade(3, 2, '2025-02-10', 'sell', '10', '110'),
    trade(4, 1, '2025-03-10', 'buy', '50', '12'),
  ],
  prices: [
    { assetId: 1, date: '2025-01-31', price: '11' },
    { assetId: 1, date: '2025-03-10', price: '12' },
    { assetId: 1, date: '2026-04-01', price: '13.2' },
  ],
  valuations: [],
};

describe('performanceSeries', () => {
  it('has a point at each month-end from the first transaction, then the last day', () => {
    expect(performanceSeries(data, '2025-04-20').map((p) => p.date)).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
      '2025-04-20',
    ]);
  });

  it('does not repeat the last day when it is a month-end', () => {
    expect(performanceSeries(data, '2025-03-31').map((p) => p.date)).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
    ]);
  });

  it('carries the last price forward through months without one', () => {
    const [jan, feb, mar] = performanceSeries(data, '2025-04-20');
    // Banyan (₹1,000 cost at ₹100) is still held on 31 Jan with no price: its last buy price is used.
    expect(jan).toMatchObject({ invested: 200000, worth: 110000 + 100000 });
    expect(feb).toMatchObject({ invested: 100000, worth: 110000 });
    expect(mar).toMatchObject({ invested: 160000, worth: 180000 });
  });

  it('is empty with no transactions, or before the first one', () => {
    expect(performanceSeries({ ...data, txns: [] }, '2025-04-20')).toEqual([]);
    expect(performanceSeries(data, '2025-01-01')).toEqual([]);
  });

  it('has a single point when everything happened this month', () => {
    const points = performanceSeries(data, '2025-01-25');
    expect(points).toEqual([{ date: '2025-01-25', invested: 200000, worth: 200000 }]);
  });

  it('plots available daily prices and transactions for a one-month range', () => {
    const points = performanceSeries(data, '2025-03-12', '2025-02-10');
    expect(points.map((point) => point.date)).toEqual([
      '2025-02-10', '2025-03-10', '2025-03-12',
    ]);
    expect(points[1]).toMatchObject({ invested: 160000, worth: 180000 });
  });

  it('uses weekly checkpoints for medium ranges and month-ends for longer ones', () => {
    expect(seriesCadence('2025-01-01', '2025-02-15')).toBe('daily');
    expect(seriesCadence('2025-01-01', '2025-02-16')).toBe('weekly');
    expect(seriesCadence('2025-01-01', '2026-01-02')).toBe('monthly');
    expect(performanceSeries(data, '2025-04-01', '2025-01-20').map((p) => p.date)).toEqual([
      '2025-01-20', '2025-01-26', '2025-02-02', '2025-02-09',
      '2025-02-16', '2025-02-23', '2025-03-02', '2025-03-09',
      '2025-03-16', '2025-03-23', '2025-03-30', '2025-04-01',
    ]);
    expect(performanceSeries(data, '2026-04-01', '2025-01-01').map((p) => p.date).slice(0, 3))
      .toEqual(['2025-01-15', '2025-01-31', '2025-02-28']);
  });

  it('samples a dense month of daily quotes, including the requested start and end', () => {
    const quoted = {
      ...data,
      prices: Array.from({ length: 30 }, (_, index) => ({
        assetId: 1,
        date: `2025-09-${String(index + 1).padStart(2, '0')}`,
        price: '10',
      })),
    };
    const dates = sampleHistoryDates(quoted, '2025-01-15', '2025-10-01', '2025-09-01');
    expect(dates).toHaveLength(31);
    expect(dates.slice(0, 3)).toEqual(['2025-09-01', '2025-09-02', '2025-09-03']);
    expect(dates.at(-1)).toBe('2025-10-01');
  });
});

describe('periodStart', () => {
  it('uses the prior day and the prior week across month boundaries', () => {
    expect(periodStart('1d', '2026-10-01', 4)).toBe('2026-09-30');
    expect(periodStart('1w', '2026-10-01', 4)).toBe('2026-09-24');
    expect(periodStart('1d', '2024-03-01', 4)).toBe('2024-02-29');
  });

  it('goes back whole months, clamped to shorter months', () => {
    expect(periodStart('1m', '2026-09-29', 4)).toBe('2026-08-29');
    expect(periodStart('1m', '2026-03-31', 4)).toBe('2026-02-28');
    expect(periodStart('3m', '2026-01-15', 4)).toBe('2025-10-15');
    expect(periodStart('6m', '2026-08-31', 4)).toBe('2026-02-28');
    expect(periodStart('3y', '2026-09-29', 4)).toBe('2023-09-29');
  });

  it('handles leap years', () => {
    expect(periodStart('1m', '2024-03-31', 4)).toBe('2024-02-29');
    expect(periodStart('1y', '2024-02-29', 4)).toBe('2023-02-28');
  });

  it('starts YTD the day before the financial year, or the calendar year', () => {
    expect(periodStart('ytd', '2026-09-29', 4)).toBe('2026-03-31');
    expect(periodStart('ytd', '2026-04-01', 4)).toBe('2026-03-31');
    expect(periodStart('ytd', '2026-02-10', 4)).toBe('2025-03-31');
    expect(periodStart('ytd', '2026-09-29', 1)).toBe('2025-12-31');
  });

  it('has no start for All time', () => {
    expect(periodStart('all', '2026-09-29', 4)).toBeNull();
  });
});

describe('one-day investment returns', () => {
  it('uses the last two available pricing days for 1 day when today has no new price', () => {
    const quoted: PortfolioData = {
      assets: [asset(1, 'Example Fund')],
      txns: [
        trade(1, 1, '2025-03-06', 'buy', '100', '10'),
        trade(2, 1, '2025-03-11', 'buy', '10', '12'),
      ],
      prices: [
        { assetId: 1, date: '2025-03-07', price: '11' },
        { assetId: 1, date: '2025-03-10', price: '12' },
      ],
      valuations: [],
    };
    const asOf = '2025-03-12';
    const daily = investmentPeriodRows(quoted, '1d', asOf, 4);
    expect(daily[0]?.from).toBe('2025-03-07');
    expect(periodTotals(daily, asOf).gain).toBe(10000);

    const buyDate = '2025-03-11';
    const yesterday = periodStart('1d', buyDate, 4)!;
    const before = buildPortfolio(quoted, yesterday)[0]!.value;
    const after = buildPortfolio(quoted, buyDate)[0]!.value;
    const calendarGain = periodTotals(periodRows(quoted, yesterday, buyDate), buyDate).gain;
    const quotedGain = periodTotals(investmentPeriodRows(quoted, '1d', buyDate, 4), buyDate).gain;
    expect(-12000 + after - before + quotedGain - calendarGain).toBe(10000);
  });

  it('falls back to yesterday without two prices and leaves longer periods unchanged', () => {
    const unpriced = { ...data, prices: [] };
    expect(investmentPeriodRows(unpriced, '1d', '2025-03-12', 4)[0]?.from).toBe('2025-03-11');
    expect(investmentPeriodRows(data, '1w', '2025-03-12', 4)[0]?.from).toBe('2025-03-05');
  });

  it('ignores future quotes and prices of investments no longer held', () => {
    const quoted: PortfolioData = {
      ...data,
      prices: [
        { assetId: 1, date: '2025-03-07', price: '11' },
        { assetId: 1, date: '2025-03-10', price: '12' },
        { assetId: 1, date: '2025-03-20', price: '13' },
        { assetId: 2, date: '2025-03-11', price: '110' },
      ],
    };
    expect(investmentPeriodRows(quoted, '1d', '2025-03-12', 4)[0]?.from).toBe('2025-03-07');
  });
});

describe('investmentPeriodRows', () => {
  it('uses each holding\'s own last two prices for 1 day', () => {
    const quoted: PortfolioData = {
      assets: [asset(1, 'Earlier Fund'), asset(2, 'Later Stock')],
      txns: [
        trade(1, 1, '2025-03-01', 'buy', '100', '10'),
        trade(2, 2, '2025-03-01', 'buy', '100', '20'),
      ],
      prices: [
        { assetId: 1, date: '2025-03-06', price: '11' },
        { assetId: 1, date: '2025-03-07', price: '12' },
        { assetId: 2, date: '2025-03-07', price: '21' },
        { assetId: 2, date: '2025-03-10', price: '22' },
      ],
      valuations: [],
    };
    const rows = investmentPeriodRows(quoted, '1d', '2025-03-12', 4);
    expect(rows.map(({ from, gain }) => ({ from, gain }))).toEqual([
      { from: '2025-03-06', gain: 10000 },
      { from: '2025-03-07', gain: 10000 },
    ]);
    expect(periodTotals(rows, '2025-03-12').gain).toBe(20000);
  });
});

describe('periodRows and periodTotals', () => {
  it('reports zero after a quiet day and includes purchases over a week', () => {
    const to = '2025-03-11';
    const day = periodRows(data, periodStart('1d', to, 4), to);
    const week = periodRows(data, periodStart('1w', to, 4), to);
    expect(day.find((row) => row.row.asset.id === 1)?.gain).toBe(0);
    expect(week.find((row) => row.row.asset.id === 1)?.gain).toBe(10000);
  });

  it('measures a period from the starting value, counting money put in', () => {
    const rows = periodRows(data, '2025-02-28', '2025-04-20');
    // Banyan was sold before the period started, so it is left out.
    expect(rows.map((r) => r.row.asset.name)).toEqual(['Meridian Flexi Fund']);
    const [m] = rows;
    // 150 × ₹12 − ₹600 bought − 100 × ₹11 at the start.
    expect(m).toMatchObject({ start: 110000, paidIn: 60000, gain: 10000, annual: null });
    expect(m!.absolute).toBeCloseTo(10000 / 170000, 10);
  });

  it('with no start date, gives the all-time return including sold holdings', () => {
    const rows = periodRows(data, null, '2025-04-20');
    expect(rows.map((r) => r.gain)).toEqual([20000, 10000]);
    const t = periodTotals(rows, '2025-04-20');
    expect(t).toMatchObject({ gain: 30000, value: 180000, invested: 160000, annual: null });
    expect(t.absolute).toBeCloseTo(30000 / 260000, 10);
    // The same figure the Investments strip shows as all-time returns.
    const all = buildPortfolio(data, '2025-04-20');
    const allTime = all.reduce(
      (s, r) => s + r.value + r.holding.inflows + r.holding.income - r.holding.outflows,
      0,
    );
    expect(t.gain).toBe(allTime);
  });

  it('annualises a period of a year or more', () => {
    const to = '2026-04-20';
    const t = periodTotals(periodRows(data, periodStart('1y', to, 4), to), to);
    expect(t.gain).toBe(18000);
    expect(t.absolute).toBeCloseTo(0.1, 10);
    expect(t.annual).toBeCloseTo(0.1, 6);
  });

  it('is empty with no holdings', () => {
    expect(periodRows({ ...data, txns: [] }, null, '2025-04-20')).toEqual([]);
    expect(periodTotals([], '2025-04-20')).toEqual({
      gain: 0,
      absolute: null,
      annual: null,
      value: 0,
      invested: 0,
    });
  });
});

describe('linePoints', () => {
  it('uses full dates for daily tooltips and compact day-month axis labels', () => {
    const points = linePoints(performanceSeries(data, '2025-03-12', '2025-02-10'), 'daily');
    expect(points.map((p) => [p.date, p.label, p.short])).toEqual([
      ['2025-02-10', '10 Feb 2025', '10 Feb'],
      ['2025-03-10', '10 Mar 2025', '10 Mar'],
      ['2025-03-12', '12 Mar 2025', '12 Mar'],
    ]);
  });

  it('labels month-ends by month and the last day by date', () => {
    const points = linePoints(performanceSeries(data, '2025-04-20'));
    expect(points.map((p) => [p.label, p.short])).toEqual([
      ['Jan 2025', 'Jan'],
      ['Feb 2025', 'Feb'],
      ['Mar 2025', 'Mar'],
      ['20 Apr 2025', 'Apr'],
    ]);
  });

  it('adds the year to axis labels on long series', () => {
    const points = linePoints(performanceSeries(data, '2026-04-20'));
    expect(points).toHaveLength(16);
    expect(points[0]!.short).toBe('Jan ’25');
  });
});
