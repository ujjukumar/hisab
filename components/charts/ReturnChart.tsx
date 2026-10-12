'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { daysBetween, monthOf, shortMonthLabel, type IsoDate } from '@/lib/domain/dates';
import { formatDate, formatDay, formatPercent, formatAxisPercent, gainClass, niceRange } from '@/lib/domain/format';
import styles from './Chart.module.css';
import { Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

export type ReturnLine = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean };

const HEIGHT = 270;
const MARGIN = { left: 52, right: 14, top: 12, bottom: 28 };

export function ReturnChart({ dates, lines }: { dates: IsoDate[]; lines: ReturnLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const width = useWidth(box);
  const [at, setAt] = useState<number | null>(null);

  if (!dates.length || !lines.length) return <div className={styles.empty}>No history to show yet</div>;

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const values = lines.flatMap((line) => line.values.filter((value): value is number => value !== null).map((value) => value * 100));
  const scale = niceRange(Math.min(0, ...values), Math.max(0, ...values), 5);
  const span = daysBetween(dates[0]!, dates.at(-1)!);
  const x = (index: number) => MARGIN.left + (span
    ? daysBetween(dates[0]!, dates[index]!) / span * innerWidth : innerWidth / 2);
  const y = (percent: number) => MARGIN.top + (scale.top - percent) / (scale.top - scale.bottom) * innerHeight;
  const paths = (line: ReturnLine) => {
    const segments: string[] = [];
    let open = false;
    line.values.forEach((value, index) => {
      if (value === null) { open = false; return; }
      segments.push(`${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value * 100).toFixed(1)}`);
      open = true;
    });
    return segments.join(' ');
  };
  const labelIndexes = new Set(dates.reduce<number[]>((shown, _, index) => {
    const last = shown.at(-1);
    return last === undefined || x(index) - x(last) >= (width < 520 ? 70 : 100)
      ? [...shown, index] : shown;
  }, []));

  function move(event: PointerEvent<SVGRectElement>) {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    let closest = 0;
    for (let index = 1; index < dates.length; index++) {
      if (Math.abs(x(index) - px) < Math.abs(x(closest) - px)) closest = index;
    }
    setAt(closest);
  }

  const tip: TipState = at === null ? null : {
    x: x(at), y: MARGIN.top + 4, title: formatDate(dates[at]!),
    rows: lines.map((line) => ({
      color: line.color,
      label: line.label,
      value: line.values[at] === null || line.values[at] === undefined
        ? '—' : formatPercent(line.values[at]! * 100),
      tone: gainClass(line.values[at] ?? 0),
    })),
  };

  return (
    <div className={styles.chart} ref={box}>
      <svg ref={svg} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img" aria-label={`Returns from ${formatDate(dates[0]!)} to ${formatDate(dates.at(-1)!)}. ${lines.map((line) => `${line.label}: ${line.values.at(-1) === null || line.values.at(-1) === undefined ? 'not available' : formatPercent(line.values.at(-1)! * 100)}`).join('; ')}`}
        onPointerLeave={() => setAt(null)}>
        {Array.from({ length: Math.round((scale.top - scale.bottom) / scale.step) + 1 }, (_, index) => {
          const tick = scale.bottom + index * scale.step;
          return <g key={index}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)}
              stroke={Math.abs(tick) < scale.step / 10 ? 'var(--line-strong)' : 'var(--grid)'}
              strokeWidth={Math.abs(tick) < scale.step / 10 ? 1.5 : 1} />
            <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">{formatAxisPercent(tick, scale.step)}</text>
          </g>;
        })}
        {dates.map((date, index) => labelIndexes.has(index) && <g key={date}>
          <line x1={x(index)} x2={x(index)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} stroke="var(--grid)" />
          <text x={x(index)} y={HEIGHT - 8} textAnchor="middle">{span > 365 ? shortMonthLabel(monthOf(date)) : formatDay(date)}</text>
        </g>)}
        {lines.map((line) => <g key={line.key}>
          <path d={paths(line)} fill="none" stroke={line.color} strokeWidth={line.dashed ? 1.8 : 2.3}
            strokeDasharray={line.dashed ? '6 4' : undefined} strokeLinejoin="round" />
          {dates.length === 1 && line.values[0] !== null &&
            <circle cx={x(0)} cy={y(line.values[0]! * 100)} r="4" fill={line.color} />}
          {at !== null && line.values[at] !== null && line.values[at] !== undefined &&
            <circle cx={x(at)} cy={y(line.values[at]! * 100)} r="4" fill={line.color}
              stroke="var(--surface)" strokeWidth="2" />}
        </g>)}
        {at !== null && <line x1={x(at)} x2={x(at)} y1={MARGIN.top} y2={MARGIN.top + innerHeight}
          stroke="var(--line-strong)" strokeDasharray="3 3" />}
        <rect x={MARGIN.left} y={MARGIN.top} width={innerWidth} height={innerHeight}
          fill="transparent" onPointerMove={move} onPointerDown={move} />
      </svg>
      <Tip state={tip} boxWidth={width} />
    </div>
  );
}