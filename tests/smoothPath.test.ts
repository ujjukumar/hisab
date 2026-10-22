import { describe, expect, it } from 'vitest';
import { smoothPath, stepPath } from '@/components/charts/smoothPath';

const ys = (d: string) => [...d.matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map((m) => Number(m[1]));

describe('smoothPath', () => {
  it('curves through every point and splits at gaps', () => {
    const d = smoothPath([[0, 10], [10, 20], null, [30, 5], [40, 5]]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toMatch(/^M0\.0,10\.0C/);
    expect(d).toContain('10.0,20.0');
  });

  it('never overshoots the highest and lowest points', () => {
    const d = smoothPath([[0, 50], [10, 0], [12, 100], [30, 100], [40, 60]]);
    for (const y of ys(d)) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });

  it('draws a lone point as a move only', () => {
    expect(smoothPath([[5, 5]])).toBe('M5.0,5.0');
  });
});

describe('stepPath', () => {
  it('steps across then up or down', () => {
    expect(stepPath([[0, 10], [10, 20], null, [30, 5]])).toBe('M0.0,10.0H10.0V20.0M30.0,5.0');
  });
});
