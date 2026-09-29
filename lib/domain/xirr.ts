import { daysBetween, type IsoDate } from './dates';

/** Money out is negative, money in positive. Any unit works; XIRR only needs the ratios. */
export type CashFlow = { date: IsoDate; amount: number };

/** A yearly rate (0.1 = 10% p.a.), or an absolute one for holdings under a year old. */
export type Return = { kind: 'pa' | 'abs'; rate: number } | null;

/**
 * Annual rate r where the flows' present value is zero, on a 365-day year.
 * Newton–Raphson from 0.1, then bisection on [−0.9999, 100] if that fails.
 * Null when the flows never change sign or no rate fits.
 */
export function xirr(flows: CashFlow[]): number | null {
  const live = flows.filter((f) => f.amount !== 0);
  if (!live.some((f) => f.amount > 0) || !live.some((f) => f.amount < 0)) return null;
  const start = live.reduce((min, f) => (f.date < min ? f.date : min), live[0]!.date);
  const points = live.map((f) => ({ t: daysBetween(start, f.date) / 365, a: f.amount }));

  const npv = (r: number) => points.reduce((s, p) => s + p.a / (1 + r) ** p.t, 0);
  const slope = (r: number) => points.reduce((s, p) => s - (p.t * p.a) / (1 + r) ** (p.t + 1), 0);

  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const d = slope(r);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - npv(r) / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-7) return next;
    r = next;
  }

  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fLo * fMid <= 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * The return to show beside a holding or group. `flows` must already include the
 * current value as its last positive flow. Under 365 days since the first flow gives
 * the absolute return (money back ÷ money in − 1) instead of an annualised one.
 */
export function annualReturn(flows: CashFlow[], asOf: IsoDate): Return {
  const live = flows.filter((f) => f.amount !== 0);
  if (live.length === 0) return null;
  const first = live.reduce((min, f) => (f.date < min ? f.date : min), live[0]!.date);
  if (daysBetween(first, asOf) < 365) {
    const out = live.reduce((s, f) => s + (f.amount < 0 ? -f.amount : 0), 0);
    const back = live.reduce((s, f) => s + (f.amount > 0 ? f.amount : 0), 0);
    return out > 0 ? { kind: 'abs', rate: back / out - 1 } : null;
  }
  const rate = xirr(live);
  return rate === null ? null : { kind: 'pa', rate };
}
