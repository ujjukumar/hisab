import { describe, expect, it } from 'vitest';
import { capSlices, type Slice } from '@/components/charts/Donut';

/** All sample data here is invented. */
const slice = (name: string, value: number): Slice => ({ name, value, color: 'var(--c1)' });

const items = [
  slice('Groceries', 500_00),
  slice('Rent', 2_000_00),
  slice('Travel', 300_00),
  slice('Bills', 900_00),
  slice('Gifts', 100_00),
  slice('Books', 50_00),
];

describe('capSlices', () => {
  it('leaves the list alone without a cap', () => {
    expect(capSlices(items)).toBe(items);
  });

  it('leaves the list alone when it already fits', () => {
    expect(capSlices(items, 6)).toBe(items);
    expect(capSlices(items, 10)).toBe(items);
  });

  it('keeps the largest slices and rolls the rest into Other', () => {
    const capped = capSlices(items, 3);
    expect(capped.map((s) => s.name)).toEqual(['Rent', 'Bills', 'Groceries', 'Other']);
    expect(capped.at(-1)!.value).toBe(300_00 + 100_00 + 50_00);
  });

  it('keeps the total unchanged, so the ring and the list agree', () => {
    const sum = (list: Slice[]) => list.reduce((total, s) => total + s.value, 0);
    expect(sum(capSlices(items, 2))).toBe(sum(items));
  });

  it('does not add an empty Other slice', () => {
    const withZeros = [...items.slice(0, 2), slice('Unused', 0)];
    expect(capSlices(withZeros, 2).map((s) => s.name)).toEqual(['Rent', 'Groceries']);
  });

  it('does not change the original list', () => {
    const before = items.map((s) => s.name);
    capSlices(items, 2);
    expect(items.map((s) => s.name)).toEqual(before);
  });
});
