import type { Paise } from './money';
import { parts, SHORT_MONTHS, type IsoDate } from './dates';
import type { Return } from './xirr';

/** U+2212, the proper minus sign. Never use a hyphen for a negative figure. */
export const MINUS = '−';

const nf = (min: number, max: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max });

const nf0 = nf(0, 0);
const nf2 = nf(2, 2);
const nf3 = nf(3, 3);

function signOf(n: number, decimals = 0): '' | '+' | typeof MINUS {
  const rounded = round(n, decimals);
  return rounded > 0 ? '+' : rounded < 0 ? MINUS : '';
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** '₹1,63,640'. Pass decimals: 2 for forms and price cells. */
export function formatINR(paise: Paise, decimals: 0 | 2 = 0): string {
  const rupees = Math.abs(paise) / 100;
  const body = decimals === 2 ? nf2.format(rupees) : nf0.format(Math.round(rupees));
  return (round(paise / 100, decimals) < 0 ? MINUS : '') + '₹' + body;
}

/** '+₹4,120' / '−₹4,120' / '₹0'. Zero gets no sign. */
export function formatINRSigned(paise: Paise, decimals: 0 | 2 = 0): string {
  const rupees = Math.abs(paise) / 100;
  const body = decimals === 2 ? nf2.format(rupees) : nf0.format(Math.round(rupees));
  return signOf(paise / 100, decimals) + '₹' + body;
}

/** Table cells: plain number, no ₹ (the card carries 'All amounts in ₹'). */
export function formatAmount(paise: Paise, decimals: 0 | 2 = 0): string {
  const rupees = Math.abs(paise) / 100;
  const body = decimals === 2 ? nf2.format(rupees) : nf0.format(Math.round(rupees));
  return (round(paise / 100, decimals) < 0 ? MINUS : '') + body;
}

export function formatAmountSigned(paise: Paise, decimals: 0 | 2 = 0): string {
  const rupees = Math.abs(paise) / 100;
  const body = decimals === 2 ? nf2.format(rupees) : nf0.format(Math.round(rupees));
  return signOf(paise / 100, decimals) + body;
}

/** Headline figures: '₹1.25 Cr', '₹21.71 Lakh', or the full amount below ₹1 Lakh. */
export function formatShortINR(paise: Paise): string {
  const rupees = Math.abs(paise) / 100;
  let body: string;
  if (rupees >= 1e7) body = (rupees / 1e7).toFixed(2) + ' Cr';
  else if (rupees >= 1e5) body = (rupees / 1e5).toFixed(2) + ' Lakh';
  else body = nf0.format(Math.round(rupees));
  return (paise < 0 ? MINUS : '') + '₹' + body;
}

export function formatShortINRSigned(paise: Paise): string {
  return signOf(paise / 100) + formatShortINR(Math.abs(paise));
}

/** '+14.80%' / '−6.10%' / '0.00%'. Never '−0.00%'. */
export function formatPercent(value: number, decimals = 2): string {
  const zero = round(value, decimals) === 0;
  return (
    (zero ? '' : signOf(value, decimals)) + Math.abs(round(value, decimals)).toFixed(decimals) + '%'
  );
}

/** Same, but no leading '+' — used in the small sub-labels under table figures. */
export function formatPercentNoPlus(value: number, decimals = 2): string {
  const zero = round(value, decimals) === 0;
  return (
    (zero || value > 0 ? '' : MINUS) + Math.abs(round(value, decimals)).toFixed(decimals) + '%'
  );
}

/** Annualised returns carry one decimal and the 'p.a.' suffix. */
export function formatReturnPa(value: number): string {
  return formatPercentNoPlus(value, 1) + ' p.a.';
}

/** Holdings under a year show the absolute return instead of an annualised one. */
export function formatReturnAbs(value: number): string {
  return formatPercentNoPlus(value, 1) + ' abs.';
}

/** An XIRR result as '12.4% p.a.' or, under a year, '3.1% abs.'. '—' when there isn't one. */
export function formatReturn(ret: Return): string {
  if (!ret) return '—';
  return ret.kind === 'pa' ? formatReturnPa(ret.rate * 100) : formatReturnAbs(ret.rate * 100);
}

/** 'pos' | 'neg' | '' — drives the gain/loss colour, never the only signal. */
export function gainClass(value: number): 'pos' | 'neg' | '' {
  const r = round(value, 2);
  return r > 0 ? 'pos' : r < 0 ? 'neg' : '';
}

/** Units and share counts: 1,660.120 units, 120 shares. */
export function formatUnits(units: string | number, decimals: 0 | 2 | 3 = 3): string {
  const n = typeof units === 'string' ? Number(units) : units;
  if (!Number.isFinite(n)) return '—';
  return (decimals === 0 ? nf0 : decimals === 2 ? nf2 : nf3).format(n);
}

/** '27 Sep 2026' */
export function formatDate(date: IsoDate): string {
  const { year, month, day } = parts(date);
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`;
}

/** '27 Sep' — compact lists and price 'as of' sub-labels. */
export function formatDay(date: IsoDate): string {
  const { month, day } = parts(date);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

/** '7:40 pm' in this computer's time zone, for "Prices updated 1 Oct, 7:40 pm". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/* ---------- chart axes ---------- */

/** '0', '75K', '1.5L', '2 Cr'. Takes rupees, not paise. */
export function axisLabel(rupees: number): string {
  const n = Math.abs(rupees);
  let body: string;
  if (n === 0) return '0';
  if (n >= 1e7) body = trim(n / 1e7, 2) + ' Cr';
  else if (n >= 1e5) body = trim(n / 1e5, 2) + 'L';
  else if (n >= 1e3) body = trim(n / 1e3, 0) + 'K';
  else body = String(Math.round(n));
  return (rupees < 0 ? MINUS : '') + body;
}

function trim(n: number, decimals: number): string {
  return String(Number(n.toFixed(decimals)));
}

/** Nice tick step: 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceStep(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/** An axis scale with roughly `targetTicks` gridlines above zero. */
export function niceScale(
  max: number,
  targetTicks: number,
): {
  top: number;
  step: number;
  ticks: number;
} {
  if (!(max > 0)) return { top: 1, step: 1, ticks: 1 };
  const step = niceStep(max / targetTicks);
  const top = Math.ceil(max / step) * step;
  return { top, step, ticks: Math.round(top / step) };
}
