import { describe, expect, it } from 'vitest';
import { draggedRange, rangeHref } from '@/components/charts/dragRange';
import { choosePeriod } from '@/lib/domain/performance';

const dates = ['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22'] as const;

describe('chart drag', () => {
  it('turns a drag either way into an oldest-first range', () => {
    expect(draggedRange(dates, 3, 1)).toEqual({ from: '2026-01-08', to: '2026-01-22' });
    expect(draggedRange(dates, 0, 2)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
  });

  it('treats a short drag as a click', () => {
    expect(draggedRange(dates, 1, 1)).toBeNull();
    expect(draggedRange(dates, 1, 2)).toBeNull();
  });

  it('links to a custom period', () => {
    expect(rangeHref('/investments/performance', { from: '2026-01-08', to: '2026-01-22' }))
      .toBe('/investments/performance?period=custom&from=2026-01-08&asof=2026-01-22');
  });
});

describe('choosePeriod', () => {
  it('keeps a valid custom start', () => {
    expect(choosePeriod('custom', '2026-03-12', '2026-06-04'))
      .toEqual({ period: 'custom', customFrom: '2026-03-12' });
  });

  it('starts a month back when the custom start is missing or not before the end', () => {
    expect(choosePeriod('custom', '', '2026-06-04').customFrom).toBe('2026-05-04');
    expect(choosePeriod('custom', '2026-06-04', '2026-06-04').customFrom).toBe('2026-05-04');
    expect(choosePeriod('custom', '2026-02-31', '2026-06-04').customFrom).toBe('2026-05-04');
  });

  it('falls back to one day for an unknown period and ignores from otherwise', () => {
    expect(choosePeriod('nope', '2026-03-12', '2026-06-04')).toEqual({ period: '1d', customFrom: null });
    expect(choosePeriod('3m', '2026-03-12', '2026-06-04')).toEqual({ period: '3m', customFrom: null });
  });
});
