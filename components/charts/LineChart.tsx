'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { axisLabel, formatShortINR, formatShortINRSigned, gainClass, niceScale } from '@/lib/domain/format';
import styles from './Chart.module.css';
import { Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

export type LinePoint = {
  /** Full label for the tooltip, e.g. 'Sep 2026'. */
  label: string;
  /** Short label for the axis, e.g. 'Sep'. */
  short: string;
  /** Paise. */
  invested: number;
  /** Paise. */
  worth: number;
};

const H = 270;
const M = { l: 50, r: 10, t: 12, b: 28 };

/** Invested against current worth over time, with a crosshair on hover. */
export function LineChart({ points }: { points: LinePoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useWidth(box);
  const [at, setAt] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className={styles.empty}>No history to show yet</div>;
  }

  const iw = width - M.l - M.r;
  const ih = H - M.t - M.b;
  const n = points.length;
  const peak = Math.max(...points.map((p) => Math.max(p.invested, p.worth))) / 100;
  const sc = niceScale(peak, 5);
  const x = (i: number) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (paise: number) => M.t + ih - (paise / 100 / sc.top) * ih;
  const path = (key: 'invested' | 'worth') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const labelStep = Math.max(1, Math.ceil(n / (width < 520 ? 4 : 7)));

  const move = (event: PointerEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    setAt(Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / iw) * (n - 1)))));
  };

  const active = at === null ? null : points[at];
  const tip: TipState =
    active && at !== null
      ? {
          x: x(at),
          y: M.t + 4,
          title: active.label,
          rows: [
            { color: 'var(--c1)', label: 'Invested', value: formatShortINR(active.invested) },
            { color: 'var(--c2)', label: 'Worth', value: formatShortINR(active.worth) },
            {
              label: 'Gain',
              value: formatShortINRSigned(active.worth - active.invested),
              tone: gainClass(active.worth - active.invested),
            },
          ],
        }
      : null;

  return (
    <div className={styles.chart} ref={box}>
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label="Line chart of amount invested and current worth over time"
        onPointerLeave={() => setAt(null)}
      >
        {Array.from({ length: sc.ticks + 1 }, (_, k) => {
          const v = sc.step * k;
          const yy = y(v * 100);
          return (
            <g key={`h${k}`}>
              <line x1={M.l} x2={width - M.r} y1={yy} y2={yy} stroke="var(--grid)" />
              <text x={M.l - 8} y={yy + 4} textAnchor="end">
                {axisLabel(v)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <g key={`v${i}`}>
              <line x1={x(i)} x2={x(i)} y1={M.t} y2={M.t + ih} stroke="var(--grid)" />
              <text x={x(i)} y={H - 8} textAnchor="middle">
                {p.short}
              </text>
            </g>
          ) : null,
        )}

        <path d={path('invested')} fill="none" stroke="var(--c1)" strokeWidth="2" strokeLinejoin="round" />
        <path d={path('worth')} fill="none" stroke="var(--c2)" strokeWidth="2.2" strokeLinejoin="round" />

        {active && at !== null && (
          <>
            <line
              x1={x(at)}
              x2={x(at)}
              y1={M.t}
              y2={M.t + ih}
              stroke="var(--line-strong)"
              strokeDasharray="3 3"
            />
            <circle cx={x(at)} cy={y(active.invested)} r="4" fill="var(--c1)" stroke="var(--surface)" strokeWidth="2" />
            <circle cx={x(at)} cy={y(active.worth)} r="4" fill="var(--c2)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}

        <rect
          x={M.l}
          y={M.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={move}
          onPointerDown={move}
        />
      </svg>
      <Tip state={tip} boxWidth={width} />
    </div>
  );
}
