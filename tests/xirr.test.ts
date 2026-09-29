import { describe, expect, it } from 'vitest';
import { annualReturn, xirr } from '@/lib/domain/xirr';

describe('xirr', () => {
  it('matches the first section 6 vector', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).not.toBeNull();
    expect(Math.abs(r! - 0.3733625)).toBeLessThan(1e-6);
  });

  it('matches the second section 6 vector', () => {
    const r = xirr([
      { date: '2023-01-01', amount: -10000 },
      { date: '2024-01-01', amount: 11000 },
    ]);
    expect(r).toBeCloseTo(0.1, 7);
  });

  it('does not care about the order of the flows', () => {
    const r = xirr([
      { date: '2024-01-01', amount: 11000 },
      { date: '2023-01-01', amount: -10000 },
    ]);
    expect(r).toBeCloseTo(0.1, 7);
  });

  it('returns null when the flows never change sign', () => {
    expect(
      xirr([
        { date: '2023-01-01', amount: -10000 },
        { date: '2024-01-01', amount: -500 },
      ]),
    ).toBeNull();
    expect(xirr([{ date: '2023-01-01', amount: 100 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('finds a heavy loss', () => {
    const r = xirr([
      { date: '2023-01-01', amount: -10000 },
      { date: '2024-01-01', amount: 100 },
    ]);
    expect(r).toBeCloseTo(-0.99, 6);
  });
});

describe('annualReturn', () => {
  it('annualises holdings a year old or more', () => {
    expect(
      annualReturn(
        [
          { date: '2023-01-01', amount: -10000 },
          { date: '2024-01-01', amount: 11000 },
        ],
        '2024-01-01',
      ),
    ).toEqual({ kind: 'pa', rate: expect.closeTo(0.1, 7) });
  });

  it('gives the absolute return under 365 days', () => {
    expect(
      annualReturn(
        [
          { date: '2026-01-01', amount: -10000 },
          { date: '2026-06-01', amount: 500 },
          { date: '2026-09-28', amount: 10300 },
        ],
        '2026-09-28',
      ),
    ).toEqual({ kind: 'abs', rate: expect.closeTo(0.08, 9) });
  });

  it('returns null with nothing invested', () => {
    expect(annualReturn([], '2026-09-28')).toBeNull();
  });
});
