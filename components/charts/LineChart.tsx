'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { axisLabel, formatShortINR, formatShortINRSigned, gainClass, niceScale, niceValueRange } from '@/lib/domain/format';
import { daysBetween, type IsoDate } from '@/lib/domain/dates';
import { Segmented } from '@/components/Segmented/Segmented';
import styles from './Chart.module.css';
import { smoothPath } from './smoothPath';
import { LegendInline, LegendKey, Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

export type LinePoint = {
  date?: IsoDate;
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
export function LineChart({ points, mode = 'portfolio' }: { points: LinePoint[]; mode?: 'portfolio' | 'netWorth' }) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useWidth(box);
  const [at, setAt] = useState<number | null>(null);
  const [view, setView] = useState<'netWorth' | 'components'>('netWorth');

  if (points.length === 0) {
    return <div className={styles.empty}>No history to show yet</div>;
  }

  const iw = width - M.l - M.r;
  const ih = H - M.t - M.b;
  const n = points.length;
  const rangeChange = points[n - 1]!.worth - points[0]!.worth;
  const components = mode === 'netWorth' && view === 'components';
  const value = (point: LinePoint, key: 'invested' | 'worth' | 'investments') => {
    const amount = key === 'investments' ? point.worth - point.invested : point[key];
    if (!components) return amount;
    const initial = key === 'investments'
      ? points[0]!.worth - points[0]!.invested : points[0]![key];
    return amount - initial;
  };
  const peak = Math.max(...points.map((p) => Math.max(p.invested, p.worth))) / 100;
  const values = components
    ? points.flatMap((p) => [value(p, 'invested'), value(p, 'investments')])
    : points.map((p) => p.worth);
  const sc = mode === 'netWorth'
    ? niceValueRange(Math.min(...values) / 100, Math.max(...values) / 100, 5)
    : { bottom: 0, ...niceScale(peak, 5) };
  const start = points.every((point) => point.date) ? points[0]?.date : undefined;
  const span = start && points[n - 1]?.date ? daysBetween(start, points[n - 1]!.date!) : 0;
  const x = (i: number) => M.l + (n === 1 ? iw / 2 : span && start
    ? (daysBetween(start, points[i]!.date!) / span) * iw
    : (i / (n - 1)) * iw);
  const y = (paise: number) => M.t + (sc.top - paise / 100) / (sc.top - sc.bottom) * ih;
  const path = (key: 'invested' | 'worth' | 'investments') =>
    smoothPath(points.map((p, i) => [x(i), y(value(p, key))]));
  const labelStep = Math.max(1, Math.ceil(n / (width < 520 ? 4 : 7)));
  const labelIndexes = new Set(points.reduce<number[]>((shown, _, index) => {
    const last = shown.at(-1);
    const visible = span ? last === undefined || x(index) - x(last) >= (width < 520 ? 70 : 100)
      : index % labelStep === 0;
    return visible ? [...shown, index] : shown;
  }, []));

  const move = (event: PointerEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    let nearest = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
    }
    setAt(nearest);
  };

  const active = at === null ? null : points[at];
  const tip: TipState =
    active && at !== null
      ? {
          x: x(at),
          y: M.t + 4,
          title: active.label,
          rows: mode === 'netWorth' ? components ? [
            { label: 'Net worth change', value: formatShortINRSigned(active.worth - points[0]!.worth) },
            { color: 'var(--c1)', label: 'Accounts', value: formatShortINRSigned(value(active, 'invested')) },
            { color: 'var(--c4)', label: 'Investments', value: formatShortINRSigned(value(active, 'investments')) },
          ] : [
            { color: 'var(--c1)', label: 'Net worth', value: formatShortINR(active.worth) },
            { label: 'Accounts', value: formatShortINR(active.invested) },
            { label: 'Investments', value: formatShortINR(active.worth - active.invested) },
          ] : [
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
      {mode === 'netWorth' && (
        <div className={styles.rangeTools}>
          <div className={styles.rangeChange}>
            <span>Change in range</span>
            <strong className={gainClass(rangeChange)}>{formatShortINRSigned(rangeChange)}</strong>
          </div>
          <Segmented
            label="Net worth chart view"
            items={[{ value: 'netWorth', label: 'Net worth' }, { value: 'components', label: 'Changes' }]}
            value={view}
            onChange={setView}
          />
        </div>
      )}
      {mode === 'netWorth' && (
        <LegendInline>
          {components ? (
            <>
              <LegendKey color="var(--c1)">Accounts change</LegendKey>
              <LegendKey color="var(--c4)">Investments change</LegendKey>
            </>
          ) : <LegendKey color="var(--c1)">Net worth</LegendKey>}
        </LegendInline>
      )}
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={mode === 'netWorth'
          ? components ? 'Changes in accounts and investments since the start of the range' : 'Net worth over time, including accounts and investments'
          : 'Line chart of amount invested and current worth over time'}
        onPointerLeave={() => setAt(null)}
      >
        {Array.from({ length: Math.round((sc.top - sc.bottom) / sc.step) + 1 }, (_, k) => {
          const v = sc.bottom + sc.step * k;
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
          labelIndexes.has(i) ? (
            <g key={`v${i}`}>
              <line x1={x(i)} x2={x(i)} y1={M.t} y2={M.t + ih} stroke="var(--grid)" />
              <text x={x(i)} y={H - 8} textAnchor="middle">
                {p.short}
              </text>
            </g>
          ) : null,
        )}

        {(mode === 'portfolio' || components) && <path d={path('invested')} fill="none" stroke="var(--c1)" strokeWidth="2" strokeLinejoin="round" />}
        {components && <path d={path('investments')} fill="none" stroke="var(--c4)" strokeWidth="2.2" strokeLinejoin="round" />}
        {!components && <path d={path('worth')} fill="none" stroke={mode === 'netWorth' ? 'var(--c1)' : 'var(--c2)'} strokeWidth="2.2" strokeLinejoin="round" />}
        {n === 1 && (
          // A single point draws no line, so mark it.
          <>
            {(mode === 'portfolio' || components) && <circle cx={x(0)} cy={y(value(points[0]!, 'invested'))} r="4" fill="var(--c1)" />}
            {components && <circle cx={x(0)} cy={y(value(points[0]!, 'investments'))} r="4" fill="var(--c4)" />}
            {!components && <circle cx={x(0)} cy={y(points[0]!.worth)} r="4" fill={mode === 'netWorth' ? 'var(--c1)' : 'var(--c2)'} />}
          </>
        )}

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
            {(mode === 'portfolio' || components) && <circle cx={x(at)} cy={y(value(active, 'invested'))} r="4" fill="var(--c1)" stroke="var(--surface)" strokeWidth="2" />}
            {components && <circle cx={x(at)} cy={y(value(active, 'investments'))} r="4" fill="var(--c4)" stroke="var(--surface)" strokeWidth="2" />}
            {!components && <circle cx={x(at)} cy={y(active.worth)} r="4" fill={mode === 'netWorth' ? 'var(--c1)' : 'var(--c2)'} stroke="var(--surface)" strokeWidth="2" />}
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
