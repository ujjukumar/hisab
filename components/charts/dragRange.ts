import type { IsoDate } from '@/lib/domain/dates';

/** Shortest drag, in points, that counts as choosing a range rather than a click. */
export const MIN_DRAG_POINTS = 2;

/** The two ends of a drag in date order, or null when the drag is too short to be a range. */
export function draggedRange(
  dates: readonly IsoDate[],
  anchor: number,
  at: number,
): { from: IsoDate; to: IsoDate } | null {
  const start = Math.min(anchor, at);
  const end = Math.max(anchor, at);
  const from = dates[start];
  const to = dates[end];
  if (end - start < MIN_DRAG_POINTS || from === undefined || to === undefined || from >= to) return null;
  return { from, to };
}

/** A link that opens `path` for a custom range: the value on `from` is the starting point. */
export function rangeHref(path: string, range: { from: IsoDate; to: IsoDate }) {
  return `${path}?${new URLSearchParams({ period: 'custom', from: range.from, asof: range.to })}`;
}
