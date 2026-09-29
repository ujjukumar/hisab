import {
  addDays,
  addMonths,
  daysInMonth,
  endOfMonth,
  financialYearOf,
  financialYearRange,
  makeDate,
  monthEndsBetween,
  monthOf,
  parts,
  shortMonthLabel,
  SHORT_MONTHS,
  type IsoDate,
} from './dates';
import { formatDate } from './format';
import type { Paise } from './money';
import { buildPortfolio, type HoldingRow, type PortfolioData } from './portfolio';
import { annualReturn, type CashFlow } from './xirr';

export type PerformancePoint = { date: IsoDate; invested: Paise; worth: Paise };

/**
 * Invested vs worth at each month-end from the first investment transaction to `to`, plus
 * `to` itself (PLAN section 6). Worth uses the latest price or statement on or before each date.
 */
export function performanceSeries(data: PortfolioData, to: IsoDate): PerformancePoint[] {
  const first = data.txns.reduce<IsoDate | null>(
    (min, t) => (!min || t.date < min ? t.date : min),
    null,
  );
  if (!first || first > to) return [];
  const dates = [...monthEndsBetween(monthOf(first), monthOf(to)).filter((d) => d < to), to];
  return dates.map((date) => {
    let invested = 0;
    let worth = 0;
    for (const r of buildPortfolio(data, date)) {
      invested += r.sold ? 0 : r.holding.cost;
      worth += r.value;
    }
    return { date, invested, worth };
  });
}

export const PERIODS = ['since', '1m', '3m', '6m', 'ytd', '1y', '3y', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const MONTHS_BACK: Partial<Record<Period, number>> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '3y': 36,
};

/**
 * The day a period is measured from: its value that day is the starting point and flows after
 * it count. The same day N months back, clamped to shorter months; for YTD the day before the
 * year starts (`yearStartMonth` 4 for the financial year, 1 for the calendar year).
 * Null for All time and Since last update, which have no start date.
 */
export function periodStart(period: Period, asOf: IsoDate, yearStartMonth: number): IsoDate | null {
  if (period === 'ytd') {
    return addDays(
      financialYearRange(financialYearOf(asOf, yearStartMonth), yearStartMonth).from,
      -1,
    );
  }
  const back = MONTHS_BACK[period];
  if (!back) return null;
  const month = addMonths(monthOf(asOf), -back);
  const { year, month: m } = parts(`${month}-01`);
  return makeDate(year, m, Math.min(parts(asOf).day, daysInMonth(year, m)));
}

export type PeriodResult = {
  gain: Paise;
  /** Gain ÷ (starting value + money paid in during the period); null when nothing was in. */
  absolute: number | null;
  /** XIRR over the period; null under a year, where annualising misleads. */
  annual: number | null;
};

export type PeriodRow = PeriodResult & {
  /** The holding on the period's last day. */
  row: HoldingRow;
  start: Paise;
  paidIn: Paise;
  /** −start value, the period's flows, +end value. */
  flows: CashFlow[];
};

function result(
  start: Paise,
  paidIn: Paise,
  gain: Paise,
  flows: CashFlow[],
  to: IsoDate,
): PeriodResult {
  const ret = annualReturn(flows, to);
  return {
    gain,
    absolute: start + paidIn > 0 ? gain / (start + paidIn) : null,
    annual: ret?.kind === 'pa' ? ret.rate : null,
  };
}

/**
 * Each holding's gain over (from, to]: value at `to` + money out of it − value at `from` − money
 * put in. With no `from` this is the all-time return. Holdings with nothing at either end and no
 * activity in between are left out.
 */
export function periodRows(data: PortfolioData, from: IsoDate | null, to: IsoDate): PeriodRow[] {
  const startValues = new Map(
    from ? buildPortfolio(data, from).map((r) => [r.asset.id, r.value]) : [],
  );
  return buildPortfolio(data, to).flatMap((row) => {
    const start = startValues.get(row.asset.id) ?? 0;
    const moved = row.holding.flows.filter((f) => !from || f.date > from);
    if (start === 0 && moved.length === 0 && row.value === 0) return [];
    const flows = [
      ...(start ? [{ date: from ?? to, amount: -start }] : []),
      ...moved,
      { date: to, amount: row.value },
    ];
    const paidIn = moved.reduce((sum, f) => sum + (f.amount < 0 ? -f.amount : 0), 0);
    const gain = flows.reduce((sum, f) => sum + f.amount, 0);
    return [{ row, start, paidIn, flows, ...result(start, paidIn, gain, flows, to) }];
  });
}

/** Since last update: each holding with two prices, from its previous price to its latest. */
export function sinceLastRows(rows: HoldingRow[]): PeriodRow[] {
  return rows.flatMap((row) =>
    row.sinceLast
      ? [
          {
            row,
            start: row.sinceLast.previousValue,
            paidIn: 0,
            flows: [],
            gain: row.sinceLast.change,
            absolute: row.sinceLast.previousValue
              ? row.sinceLast.change / row.sinceLast.previousValue
              : null,
            annual: null,
          },
        ]
      : [],
  );
}

/** A group's or the whole portfolio's figures; XIRR combines every holding's flows. */
export function periodTotals(
  rows: PeriodRow[],
  to: IsoDate,
): PeriodResult & { value: Paise; invested: Paise } {
  let start = 0;
  let paidIn = 0;
  let value = 0;
  let invested = 0;
  let gain = 0;
  for (const r of rows) {
    start += r.start;
    paidIn += r.paidIn;
    value += r.row.value;
    invested += r.row.sold ? 0 : r.row.holding.cost;
    gain += r.gain;
  }
  return {
    ...result(
      start,
      paidIn,
      gain,
      rows.flatMap((r) => r.flows),
      to,
    ),
    value,
    invested,
  };
}

/**
 * Chart points: month-ends read as their month ('Sep 2026'), the last day as its date. Axis
 * labels carry the year once the series is over a year long.
 */
export function linePoints(
  points: PerformancePoint[],
): { label: string; short: string; invested: Paise; worth: Paise }[] {
  const long = points.length > 13;
  return points.map(({ date, invested, worth }) => {
    const { year, month } = parts(date);
    const monthEnd = date === endOfMonth(monthOf(date));
    return {
      label: monthEnd ? shortMonthLabel(monthOf(date)) : formatDate(date),
      short: long
        ? `${SHORT_MONTHS[month - 1]} ’${String(year).slice(2)}`
        : SHORT_MONTHS[month - 1]!,
      invested,
      worth,
    };
  });
}

export const PERIOD_LABELS: Record<Period, string> = {
  since: 'Since last update',
  '1m': '1 month',
  '3m': '3 months',
  '6m': '6 months',
  ytd: 'Financial year to date',
  '1y': '1 year',
  '3y': '3 years',
  all: 'All time',
};
