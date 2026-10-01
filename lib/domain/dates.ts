/**
 * Date-only helpers. Dates are 'YYYY-MM-DD' strings and months are 'YYYY-MM'.
 * Nothing here creates a local Date from a date string, so there are no timezone shifts.
 */

export type IsoDate = string; // YYYY-MM-DD
export type IsoMonth = string; // YYYY-MM

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isValidDate(date: string): date is IsoDate {
  if (!DATE_RE.test(date)) return false;
  const { year, month, day } = parts(date);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isValidMonth(month: string): month is IsoMonth {
  if (!MONTH_RE.test(month)) return false;
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12;
}

export function parts(date: IsoDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Today in the owner's local timezone, as YYYY-MM-DD. */
export function today(now: Date = new Date()): IsoDate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function currentMonth(now: Date = new Date()): IsoMonth {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}`;
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function startOfMonth(month: IsoMonth): IsoDate {
  return `${month}-01`;
}

export function endOfMonth(month: IsoMonth): IsoDate {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${month}-${pad(daysInMonth(year, m))}`;
}

export function addMonths(month: IsoMonth, delta: number): IsoMonth {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = year * 12 + (m - 1) + delta;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

/** Add days to a date. Uses a UTC Date internally so no local timezone can shift it. */
export function addDays(date: IsoDate, delta: number): IsoDate {
  const { year, month, day } = parts(date);
  const ms = Date.UTC(year, month - 1, day) + delta * 86_400_000;
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Sunday = 0, Saturday = 6, independent of the machine's timezone. */
export function dayOfWeek(date: IsoDate): number {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** Years between two dates on a 365-day year, the convention used for XIRR and FD maths. */
export function yearsBetween(from: IsoDate, to: IsoDate): number {
  return daysBetween(from, to) / 365;
}

/** The last day of each month from `fromMonth` to `toMonth`, inclusive. */
export function monthEndsBetween(fromMonth: IsoMonth, toMonth: IsoMonth): IsoDate[] {
  const out: IsoDate[] = [];
  let m = fromMonth;
  while (m <= toMonth) {
    out.push(endOfMonth(m));
    m = addMonths(m, 1);
  }
  return out;
}

/* ---------- financial year (India: April to March by default) ---------- */

/** The financial year a date belongs to, named by its starting year. 2026-03-31 → 2025. */
export function financialYearOf(date: IsoDate, startMonth = 4): number {
  const { year, month } = parts(date);
  return month >= startMonth ? year : year - 1;
}

export function financialYearRange(
  startYear: number,
  startMonth = 4,
): { from: IsoDate; to: IsoDate } {
  const from = makeDate(startYear, startMonth, 1);
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  return { from, to: makeDate(endYear, endMonth, daysInMonth(endYear, endMonth)) };
}

export function financialYearLabel(startYear: number, startMonth = 4): string {
  if (startMonth === 1) return String(startYear);
  return `${startYear}–${String(startYear + 1).slice(2)}`;
}

/* ---------- labels ---------- */

/** 'September 2026' */
export function monthLabel(month: IsoMonth): string {
  const m = Number(month.slice(5, 7));
  return `${MONTH_NAMES[m - 1]} ${month.slice(0, 4)}`;
}

/** 'Sep 2026' */
export function shortMonthLabel(month: IsoMonth): string {
  const m = Number(month.slice(5, 7));
  return `${SHORT_MONTHS[m - 1]} ${month.slice(0, 4)}`;
}
