/** A point on screen, or null for a gap in the line. */
export type PathPoint = readonly [x: number, y: number] | null;

const f = (n: number) => n.toFixed(1);

/**
 * An SVG path through the points as a monotone cubic curve (Fritsch–Carlson), so the
 * line is smooth but never overshoots into highs or lows the data doesn't have.
 */
export function smoothPath(points: readonly PathPoint[]): string {
  const parts: string[] = [];
  let run: (readonly [number, number])[] = [];
  const flush = () => {
    if (run.length) parts.push(monotone(run));
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else flush();
  }
  flush();
  return parts.join(' ');
}

/** Flat between points and upright at each change, for amounts that move in jumps. */
export function stepPath(points: readonly PathPoint[]): string {
  const parts: string[] = [];
  let open = false;
  for (const point of points) {
    if (!point) { open = false; continue; }
    parts.push(open ? `H${f(point[0])}V${f(point[1])}` : `M${f(point[0])},${f(point[1])}`);
    open = true;
  }
  return parts.join('');
}

function monotone(p: readonly (readonly [number, number])[]): string {
  const n = p.length;
  const start = `M${f(p[0]![0])},${f(p[0]![1])}`;
  if (n === 1) return start;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1]![0] - p[i]![0]);
    slope.push(dx[i] ? (p[i + 1]![1] - p[i]![1]) / dx[i]! : 0);
  }
  const tangent = p.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    return slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!;
    const b = tangent[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangent[i] = k * a * slope[i]!;
      tangent[i + 1] = k * b * slope[i]!;
    }
  }
  let d = start;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${f(x0 + h)},${f(y0 + tangent[i]! * h)} ${f(x1 - h)},${f(y1 - tangent[i + 1]! * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
