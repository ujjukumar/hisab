import { describe, expect, it } from 'vitest';
import { sortRows } from '@/components/DataTable/sorting';

describe('sortRows', () => {
  const rows = [
    { name: 'Fund 10', value: 10 },
    { name: 'Fund 2', value: 2 },
    { name: 'Fund 1', value: null },
  ];

  it('sorts numeric and natural-text values ascending without changing the input', () => {
    expect(sortRows(rows, (row) => row.value, 'asc').map((row) => row.name))
      .toEqual(['Fund 2', 'Fund 10', 'Fund 1']);
    expect(rows.map((row) => row.name)).toEqual(['Fund 10', 'Fund 2', 'Fund 1']);
    expect(sortRows(rows, (row) => row.name, 'asc').map((row) => row.name))
      .toEqual(['Fund 1', 'Fund 2', 'Fund 10']);
  });

  it('keeps empty values last in descending order too', () => {
    expect(sortRows(rows, (row) => row.value, 'desc').map((row) => row.name))
      .toEqual(['Fund 10', 'Fund 2', 'Fund 1']);
  });
});