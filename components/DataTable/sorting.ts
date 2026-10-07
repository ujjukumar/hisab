import type { SortDirection } from './DataTable';

export type SortValue = string | number | null;

export function sortRows<T>(
  rows: T[],
  valueOf: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  return [...rows].sort((left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    if (leftValue === null || rightValue === null) {
      return leftValue === rightValue ? 0 : leftValue === null ? 1 : -1;
    }
    const order = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
    return direction === 'asc' ? order : -order;
  });
}