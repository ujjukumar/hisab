import { GROUPS, type GroupKey } from './assets';
import { Decimal } from 'decimal.js';
import { addMonths, daysBetween, daysInMonth, isValidDate, makeDate, monthOf, parts, type IsoDate } from './dates';
import { periodStart, sampleHistoryDates } from './performance';
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
  groups: Partial<Record<GroupKey, number | null>>;
};

/** Gain on starting value and money paid in, using the same cash flows as periodRows. */
export function returnSeries(data: PortfolioData, to: IsoDate, from: IsoDate | null): ReturnPoint[] {
  const first = data.txns.reduce<IsoDate | null>(
    (earliest, txn) => earliest === null || txn.date < earliest ? txn.date : earliest,
    null,
  );
  if (!first || first > to) return [];
  const atStart = from ? buildPortfolio(data, from) : [];
  const startValues = new Map(atStart.map((row) => [row.asset.id, row.value]));

  return sampleHistoryDates(data, first, to, from).map((date) => {
    const groups: Partial<Record<GroupKey, { gain: number; paidIn: number; start: number }>> = {};
    for (const row of buildPortfolio(data, date)) {
      const startValue = startValues.get(row.asset.id) ?? 0;
      const flows = row.holding.flows.filter((flow) => !from || flow.date > from);
      const paidIn = flows.reduce((sum, flow) => sum + Math.max(0, -flow.amount), 0);
      const gain = row.value - startValue + flows.reduce((sum, flow) => sum + flow.amount, 0);
      const total = groups[row.group] ?? { gain: 0, paidIn: 0, start: 0 };
      total.gain += gain;
      total.paidIn += paidIn;
      total.start += startValue;
      groups[row.group] = total;
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
      groups: Object.fromEntries(GROUPS.flatMap(({ key }) => groups[key]
        ? [[key, percent(groups[key])]] : [])) as ReturnPoint['groups'],
    };
  });
}

/** An index fund bought with the same starting value and on the same capital-flow dates. */
export function benchmarkReturns(
  data: PortfolioData,
  points: ReturnPoint[],
  from: IsoDate | null,
  history: readonly { date: IsoDate; price: string | null }[],
): { values: (number | null)[]; error: string | null } {
  if (!points.length) return { values: [], error: null };
  const quotes = history.filter((row): row is { date: IsoDate; price: string } =>
    row.price !== null && new Decimal(row.price).gt(0)).sort((a, b) => a.date.localeCompare(b.date));
  const priceOn = (date: IsoDate) => {
    const quote = quotes.filter((row) => row.date <= date).at(-1);
    return quote && daysBetween(quote.date, date) <= 7 ? new Decimal(quote.price) : null;
  };
  const initial = from ? buildPortfolio(data, from).reduce((sum, row) => sum + row.value, 0) : 0;
  let units = new Decimal(0);
  if (initial) {
    const price = priceOn(from!);
    if (!price) return { values: points.map(() => null), error: 'No benchmark NAV near the start date. Fetch past prices in Settings or choose a later range.' };
    units = new Decimal(initial).div(100).div(price);
  }
  const flows = data.txns.filter((txn) => (!from || txn.date > from) && txn.date <= points.at(-1)!.date)
    .filter((txn) => ['buy', 'deposit', 'fee', 'sell', 'withdrawal'].includes(txn.action))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let index = 0;
  let paidIn = 0;
  let paidOut = 0;
  const values: (number | null)[] = [];
  for (const point of points) {
    while (index < flows.length && flows[index]!.date <= point.date) {
      const txn = flows[index++]!;
      const amount = txn.action === 'sell' || txn.action === 'withdrawal'
        ? -(txn.amount ?? 0) + txn.fees
        : (txn.amount ?? 0) + txn.fees;
      if (!amount) continue;
      const price = priceOn(txn.date);
      if (!price) return { values: points.map(() => null), error: `No benchmark NAV near ${txn.date}. Fetch past prices in Settings.` };
      const change = new Decimal(amount).div(100).div(price);
      if (units.plus(change).lt(-0.00000001)) return {
        values: points.map(() => null), error: 'This benchmark could not cover a withdrawal in this range.',
      };
      units = Decimal.max(0, units.plus(change));
      if (amount > 0) paidIn += amount;
      else paidOut -= amount;
    }
    const price = priceOn(point.date);
    const worth = price ? units.times(price).times(100).toDecimalPlaces(0).toNumber() : null;
    values.push(worth === null || point.capital <= 0 ? null
      : (worth + paidOut - initial - paidIn) / point.capital);
  }
  return { values, error: null };
}