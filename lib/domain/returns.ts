import { GROUPS, type GroupKey } from './assets';
import { Decimal } from 'decimal.js';
import { addDays, addMonths, daysBetween, daysInMonth, isValidDate, makeDate, monthOf, parts, type IsoDate } from './dates';
import { periodStart } from './performance';
import { buildPortfolio, type PortfolioData } from './portfolio';

export const RETURN_RANGES = [
  ['ytd', 'YTD'], ['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['1y', '1Y'],
  ['3y', '3Y'], ['5y', '5Y'], ['10y', '10Y'], ['all', 'All'], ['custom', 'Custom'],
] as const;
export type ReturnRange = (typeof RETURN_RANGES)[number][0];

export function returnRangeStart(range: ReturnRange, to: IsoDate): IsoDate | null {
  if (range === 'all' || range === 'custom') return null;
  if (range === 'ytd') return periodStart('ytd', to, 1);
  const months: Record<Exclude<ReturnRange, 'all' | 'custom' | 'ytd'>, number> = {
    '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60, '10y': 120,
  };
  const month = addMonths(monthOf(to), -months[range]);
  const { year, month: number } = parts(`${month}-01`);
  return makeDate(year, number, Math.min(parts(to).day, daysInMonth(year, number)));
}

export function pickReturnRange(
  requested: { range?: string; from?: string; to?: string },
  asOf: IsoDate,
  first: IsoDate,
) {
  const available = RETURN_RANGES.filter(([range]) =>
    range === 'all' || range === 'custom' || returnRangeStart(range, asOf)! >= first,
  );
  const fallback: ReturnRange = available.some(([range]) => range === '1y') ? '1y' : 'all';
  const range = available.some(([value]) => value === requested.range)
    ? requested.range as ReturnRange : fallback;
  if (range !== 'custom') return { range, from: returnRangeStart(range, asOf), to: asOf, available, error: null };
  const from = requested.from;
  const to = requested.to;
  if (!from || !to || !isValidDate(from) || !isValidDate(to))
    return { range, from: null, to: asOf, available, error: 'Choose valid start and end dates.' };
  const end = to > asOf ? asOf : to;
  if (from >= end) return { range, from: null, to: end, available, error: 'Choose a start date before the end date.' };
  return { range, from, to: end, available, error: null };
}

export type ReturnPoint = {
  date: IsoDate;
  portfolio: number | null;
  capital: number;
  /** Paise. What everything was worth on the day. */
  value: number;
  /** Paise. What the holdings on the day cost, whatever the range. */
  invested: number;
  /** Paise. Gain since the start of the range, after money added or taken out. */
  gain: number;
  /** Paise. Money paid in less money taken out since the start of the range. */
  added: number;
  /** Paise. Gain or loss locked in by sales and withdrawals since the start of the range (average cost). */
  booked: number;
  /** Paise. Dividends and interest paid out since the start of the range. */
  income: number;
  groups: Partial<Record<GroupKey, number | null>>;
};

const CHART_POINTS = 250;

/** Evenly spaced dates for the returns chart, daily for short ranges, plus every transaction date. */
export function returnDates(
  data: Pick<PortfolioData, 'txns'>,
  first: IsoDate,
  to: IsoDate,
  from: IsoDate | null,
): IsoDate[] {
  if (first > to) return [];
  const start = from && from > first ? from : first;
  const step = Math.max(1, Math.ceil(daysBetween(start, to) / CHART_POINTS));
  const dates = new Set<IsoDate>([start, to]);
  for (let date = addDays(start, step); date < to; date = addDays(date, step)) dates.add(date);
  for (const txn of data.txns) {
    if (txn.date > start && txn.date < to) dates.add(txn.date);
  }
  return [...dates].sort();
}

/** Gain on starting value and money paid in, using the same cash flows as periodRows. */
export function returnSeries(data: PortfolioData, to: IsoDate, from: IsoDate | null): ReturnPoint[] {
  const first = data.txns.reduce<IsoDate | null>(
    (earliest, txn) => earliest === null || txn.date < earliest ? txn.date : earliest,
    null,
  );
  if (!first || first > to) return [];
  const atStart = from ? buildPortfolio(data, from) : [];
  const startValues = new Map(atStart.map((row) => [row.asset.id, row.value]));
  const startBooked = new Map(atStart.map((row) => [row.asset.id, row.holding.realised]));
  const startIncome = new Map(atStart.map((row) => [row.asset.id, row.holding.income]));

  return returnDates(data, first, to, from).map((date) => {
    const groups: Partial<Record<GroupKey, { gain: number; paidIn: number; start: number }>> = {};
    let value = 0;
    let invested = 0;
    let added = 0;
    let booked = 0;
    let income = 0;
    for (const row of buildPortfolio(data, date)) {
      booked += row.holding.realised - (startBooked.get(row.asset.id) ?? 0);
      income += row.holding.income - (startIncome.get(row.asset.id) ?? 0);
      const startValue = startValues.get(row.asset.id) ?? 0;
      const flows = row.holding.flows.filter((flow) => !from || flow.date > from);
      const paidIn = flows.reduce((sum, flow) => sum + Math.max(0, -flow.amount), 0);
      const net = flows.reduce((sum, flow) => sum + flow.amount, 0);
      const gain = row.value - startValue + net;
      added -= net;
      const total = groups[row.group] ?? { gain: 0, paidIn: 0, start: 0 };
      total.gain += gain;
      total.paidIn += paidIn;
      total.start += startValue;
      groups[row.group] = total;
      value += row.value;
      if (!row.sold) invested += row.holding.cost;
    }
    const active = GROUPS.flatMap(({ key }) => groups[key] ? [groups[key]] : []);
    const total = active.reduce((sum, group) => ({
      gain: sum.gain + group.gain,
      paidIn: sum.paidIn + group.paidIn,
      start: sum.start + group.start,
    }), { gain: 0, paidIn: 0, start: 0 });
    const percent = (group: typeof total) => group.start + group.paidIn > 0
      ? group.gain / (group.start + group.paidIn) : null;
    return {
      date,
      portfolio: percent(total),
      capital: total.start + total.paidIn,
      value,
      invested,
      gain: total.gain,
      added,
      booked,
      income,
      groups: Object.fromEntries(GROUPS.flatMap(({ key }) => groups[key]
        ? [[key, percent(groups[key])]] : [])) as ReturnPoint['groups'],
    };
  });
}

/** A market index "bought" with the same starting value and on the same capital-flow dates. */
export function benchmarkReturns(
  data: PortfolioData,
  points: ReturnPoint[],
  from: IsoDate | null,
  history: readonly { date: IsoDate; price: string | null }[],
): { values: (number | null)[]; worth: (number | null)[]; error: string | null } {
  if (!points.length) return { values: [], worth: [], error: null };
  const quotes = history.filter((row): row is { date: IsoDate; price: string } =>
    row.price !== null && new Decimal(row.price).gt(0)).sort((a, b) => a.date.localeCompare(b.date));
  const priceOn = (date: IsoDate) => {
    let low = 0;
    let high = quotes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (quotes[mid]!.date <= date) low = mid + 1;
      else high = mid;
    }
    const quote = quotes[low - 1];
    return quote && daysBetween(quote.date, date) <= 7 ? new Decimal(quote.price) : null;
  };
  const fail = (error: string) => ({ values: points.map(() => null), worth: points.map(() => null), error });
  const initial = from ? buildPortfolio(data, from).reduce((sum, row) => sum + row.value, 0) : 0;
  let units = new Decimal(0);
  if (initial) {
    const price = priceOn(from!);
    if (!price) return fail('No index close near the start date. Its history may not reach back that far, so choose a later range.');
    units = new Decimal(initial).div(100).div(price);
  }
  const flows = data.txns.filter((txn) => (!from || txn.date > from) && txn.date <= points.at(-1)!.date)
    .filter((txn) => ['buy', 'deposit', 'fee', 'sell', 'withdrawal'].includes(txn.action))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let index = 0;
  let paidIn = 0;
  let paidOut = 0;
  const values: (number | null)[] = [];
  const worths: (number | null)[] = [];
  for (const point of points) {
    while (index < flows.length && flows[index]!.date <= point.date) {
      const txn = flows[index++]!;
      const amount = txn.action === 'sell' || txn.action === 'withdrawal'
        ? -(txn.amount ?? 0) + txn.fees
        : (txn.amount ?? 0) + txn.fees;
      if (!amount) continue;
      const price = priceOn(txn.date);
      if (!price) return fail(`No index close near ${txn.date}. Its history may not reach back that far, so choose a later range.`);
      const change = new Decimal(amount).div(100).div(price);
      if (units.plus(change).lt(-0.00000001)) return fail('This benchmark could not cover a withdrawal in this range.');
      units = Decimal.max(0, units.plus(change));
      if (amount > 0) paidIn += amount;
      else paidOut -= amount;
    }
    const price = priceOn(point.date);
    const worth = price ? units.times(price).times(100).toDecimalPlaces(0).toNumber() : null;
    worths.push(worth);
    values.push(worth === null || point.capital <= 0 ? null
      : (worth + paidOut - initial - paidIn) / point.capital);
  }
  return { values, worth: worths, error: null };
}