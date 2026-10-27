'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { axisLabel, formatShortINR, niceScale } from '@/lib/domain/format';
import type { Paise } from '@/lib/domain/money';
import styles from './Chart.module.css';
import { LegendInline, LegendKey, Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

const H = 220;
const M = { l: 50, r: 10, t: 12, b: 28 };

const running = (days: Paise[]) =>
  days.reduce<Paise[]>((sums, day) => [...sums, (sums.at(-1) ?? 0) + day], []);

/**
 * Spending so far this month against last month, day by day, with the month's budget as a
 * straight line from nothing on the 1st to the full budget on the last day.
 */
export function PaceChart({
  thisMonth,
  lastMonth,
  daysInMonth,
  budget,
  thisLabel,
  lastLabel,
}: {
  /** Spending on each day so far this month, today included. */
  thisMonth: Paise[];
  /** Spending on each day of last month. */
  lastMonth: Paise[];
  daysInMonth: number;
  /** The month's total budget, or 0 when none is set. */
  budget: Paise;
  thisLabel: string;
  lastLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useWidth(box);
  const [at, setAt] = useState<number | null>(null);

  const now = running(thisMonth);
  const before = running(lastMonth);
  const days = Math.max(daysInMonth, before.length);
  const sc = niceScale(Math.max(now.at(-1) ?? 0, before.at(-1) ?? 0, budget) / 100, 4);
  const iw = width - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (day: number) => M.l + (days > 1 ? ((day - 1) / (days - 1)) * iw : iw / 2);
  const y = (paise: number) => M.t + (1 - paise / 100 / sc.top) * ih;
  const line = (sums: Paise[]) => sums.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1)},${y(v)}`).join('');
  const ticks = [1, 8, 15, 22, days];

  const move = (event: PointerEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const day = Math.round(((event.clientX - rect.left - M.l) / iw) * (days - 1)) + 1;
    setAt(Math.min(days, Math.max(1, day)));
  };

  const tip: TipState =
    at !== null
      ? {
          x: x(at),
          y: M.t + 4,
          title: `Day ${at}`,
          rows: [
            ...(at <= now.length
              ? [{ color: 'var(--c1)', label: thisLabel, value: formatShortINR(now[at - 1]!) }]
              : []),
            ...(at <= before.length
              ? [{ color: 'var(--c-muted)', label: lastLabel, value: formatShortINR(before[at - 1]!) }]
              : []),
            ...(budget ? [{ label: 'Budget pace', value: formatShortINR(Math.round((budget * at) / days)) }] : []),
          ],
        }
      : null;

  return (
    <div className={styles.chart} ref={box}>
      <LegendInline>
        <LegendKey color="var(--c1)">{thisLabel}</LegendKey>
        <LegendKey color="var(--c-muted)" dashed>
          {lastLabel}
        </LegendKey>
        {budget > 0 && (
          <LegendKey color="var(--text-3)">Budget pace</LegendKey>
        )}
      </LegendInline>
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`Spending so far: ${formatShortINR(now.at(-1) ?? 0)} by day ${now.length}, against ${formatShortINR(before[Math.min(now.length, before.length) - 1] ?? 0)} by the same day of ${lastLabel}${budget ? ` and a budget of ${formatShortINR(budget)}` : ''}`}
        onPointerLeave={() => setAt(null)}
      >
        {Array.from({ length: sc.ticks + 1 }, (_, k) => {
          const v = sc.step * k;
          return (
            <g key={`h${k}`}>
              <line x1={M.l} x2={width - M.r} y1={y(v * 100)} y2={y(v * 100)} stroke="var(--grid)" />
              <text x={M.l - 8} y={y(v * 100) + 4} textAnchor="end">
                {axisLabel(v)}
              </text>
            </g>
          );
        })}
        {ticks.map((day) => (
          <text key={`d${day}`} x={x(day)} y={H - 8} textAnchor="middle">
            {day}
          </text>
        ))}
        {budget > 0 && (
          <line
            x1={x(1)}
            y1={y(budget / days)}
            x2={x(days)}
            y2={y(budget)}
            stroke="var(--text-3)"
            strokeWidth="1"
          />
        )}
        <path d={line(before)} fill="none" stroke="var(--c-muted)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={line(now)} fill="none" stroke="var(--c1)" strokeWidth="2.4" strokeLinejoin="round" />
        {now.length > 0 && <circle cx={x(now.length)} cy={y(now.at(-1)!)} r="4" fill="var(--c1)" />}
        {at !== null && (
          <line x1={x(at)} x2={x(at)} y1={M.t} y2={M.t + ih} stroke="var(--line-strong)" strokeDasharray="3 3" />
        )}
        <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" onPointerMove={move} onPointerDown={move} />
      </svg>
      <Tip state={tip} boxWidth={width} />
    </div>
  );
}
