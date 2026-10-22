'use client';

import { useId, useRef, useState, type PointerEvent } from 'react';
import { Segmented } from '@/components/Segmented/Segmented';
import { daysBetween, monthOf, shortMonthLabel, type IsoDate } from '@/lib/domain/dates';
import {
  axisLabel,
  formatAxisPercent,
  formatDate,
  formatDay,
  formatPercent,
  formatShortINR,
  formatShortINRSigned,
  gainClass,
  niceRange,
  niceValueRange,
} from '@/lib/domain/format';
import styles from './Chart.module.css';
import { smoothPath, stepPath, type PathPoint } from './smoothPath';
import { LegendInline, LegendKey, Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

export type ReturnLine = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean };

/** Amounts in paise, one per date. */
export type ValueSeries = {
  worth: number[];
  invested: number[];
  /** Portfolio return % per date, for the headline and tooltip. */
  percent: (number | null)[];
  /** Gain and net money added since the start of the range. */
  gain: number[];
  added: number[];
  /** Gain since the start of the range as a share of the money at work. */
  gainPercent: (number | null)[];
  /** Short name of the range, such as 6M. */
  rangeLabel: string;
  /** What the same money would be worth in each benchmark. */
  benchmarks: ReturnLine[];
};

type Mode = 'value' | 'percent';

const HEIGHT = 300;
const MARGIN = { left: 56, right: 14, top: 12, bottom: 28 };
const WORTH = 'var(--c1)';
const INVESTED = 'var(--text-3)';

export function ReturnChart({ dates, lines, value }: {
  dates: IsoDate[];
  lines: ReturnLine[];
  value?: ValueSeries;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const width = useWidth(box);
  const fill = `worth-${useId().replace(/[^\w-]/g, '')}`;
  const [at, setAt] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>(value ? 'value' : 'percent');

  if (!dates.length || (!lines.length && !value)) {
    return <div className={styles.empty}>No history to show yet</div>;
  }

  const showValue = mode === 'value' && value !== undefined;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = daysBetween(dates[0]!, dates.at(-1)!);
  const x = (index: number) => MARGIN.left + (span
    ? daysBetween(dates[0]!, dates[index]!) / span * innerWidth : innerWidth / 2);

  // Both modes share one y scale shape: the axis unit is rupees in value mode, percent otherwise.
  const plotted = showValue
    ? [...value.worth, ...value.invested,
      ...value.benchmarks.flatMap((line) => line.values.filter((v): v is number => v !== null))]
      .map((paise) => paise / 100)
    : lines.flatMap((line) => line.values.filter((v): v is number => v !== null).map((v) => v * 100));
  const scale = showValue
    ? niceValueRange(Math.min(...plotted), Math.max(...plotted), 5)
    : niceRange(Math.min(0, ...plotted), Math.max(0, ...plotted), 5);
  const y = (unit: number) => MARGIN.top + (scale.top - unit) / (scale.top - scale.bottom) * innerHeight;
  const unitOf = (v: number) => showValue ? v / 100 : v * 100;
  const pointsOf = (values: readonly (number | null)[]): PathPoint[] =>
    values.map((v, index) => v === null ? null : [x(index), y(unitOf(v))]);

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

  const last = dates.length - 1;
  const gainAt = (index: number) => value ? value.worth[index]! - value.invested[index]! : 0;
  const percentAt = (index: number) => value?.percent[index] ?? null;
  const percentText = (index: number) => percentAt(index) === null ? '' : ` (${formatPercent(percentAt(index)! * 100)})`;
  const rangePercentText = (index: number) => value?.gainPercent[index] === null || value?.gainPercent[index] === undefined
    ? '' : ` (${formatPercent(value.gainPercent[index]! * 100)})`;

  const valueLines: ReturnLine[] = value ? [
    { key: 'worth', label: 'Worth', color: WORTH, values: value.worth },
    { key: 'invested', label: 'Invested', color: INVESTED, values: value.invested },
    ...value.benchmarks,
  ] : [];
  const shown = showValue ? valueLines : lines;
  const dots = shown.filter((line) => line.key !== 'invested');

  const tip: TipState = at === null ? null : {
    x: x(at), y: MARGIN.top + 4, title: formatDate(dates[at]!),
    rows: showValue ? [
      { color: WORTH, label: 'Worth', value: formatShortINR(value.worth[at]!) },
      { color: INVESTED, label: 'Invested', value: formatShortINR(value.invested[at]!) },
      { label: 'Gain on cost', value: `${formatShortINRSigned(gainAt(at))}${percentText(at)}`, tone: gainClass(gainAt(at)) },
      { label: 'Added since start', value: formatShortINRSigned(value.added[at]!) },
      { label: 'Gain since start', value: `${formatShortINRSigned(value.gain[at]!)}${rangePercentText(at)}`, tone: gainClass(value.gain[at]!) },
      ...value.benchmarks.map((line) => ({
        color: line.color,
        label: line.label,
        value: line.values[at] === null || line.values[at] === undefined ? '—' : formatShortINR(line.values[at]!),
      })),
    ] : lines.map((line) => ({
      color: line.color,
      label: line.label,
      value: line.values[at] === null || line.values[at] === undefined
        ? '—' : formatPercent(line.values[at]! * 100),
      tone: gainClass(line.values[at] ?? 0),
    })),
  };

  const legendValue = (line: ReturnLine) => {
    const end = line.values.at(-1);
    if (end === null || end === undefined) return '—';
    return showValue ? formatShortINR(end) : formatPercent(end * 100);
  };

  const worthPoints = showValue ? pointsOf(value.worth) : [];
  const area = showValue && worthPoints.length > 1
    ? `${smoothPath(worthPoints)}L${x(last).toFixed(1)},${(MARGIN.top + innerHeight).toFixed(1)}L${x(0).toFixed(1)},${(MARGIN.top + innerHeight).toFixed(1)}Z`
    : null;

  const label = showValue
    ? `Portfolio worth from ${formatDate(dates[0]!)} to ${formatDate(dates[last]!)}: ${formatShortINR(value.worth[0]!)} to ${formatShortINR(value.worth[last]!)}, invested ${formatShortINR(value.invested[last]!)}, ${value.rangeLabel} added ${formatShortINRSigned(value.added[last]!)}, gain ${formatShortINRSigned(value.gain[last]!)}${rangePercentText(last)}.`
    : `Returns from ${formatDate(dates[0]!)} to ${formatDate(dates[last]!)}. ${lines.map((line) => `${line.label}: ${legendValue(line)}`).join('; ')}`;

  return (
    <>
      {value && <div className={styles.rangeTools}>
        <div className={styles.headline}>
          <strong>{formatShortINR(value.worth[last]!)}</strong>
          <span className={styles.rangeChange}>
            <span>{value.rangeLabel}</span>
            <span>Added <strong>{formatShortINRSigned(value.added[last]!)}</strong></span>
            <span>·</span>
            <span>Gain <strong className={gainClass(value.gain[last]!)}>
              {formatShortINRSigned(value.gain[last]!)}{rangePercentText(last)}
            </strong></span>
          </span>
          {value.worth[0]! > 0 && last > 0 && <span className={styles.rangeFrom}>
            {formatShortINR(value.worth[0]!)} on {formatDate(dates[0]!)} → {formatShortINR(value.worth[last]!)}
          </span>}
        </div>
        <Segmented label="Chart shows" value={mode} onChange={setMode}
          items={[{ value: 'value' as const, label: 'Value ₹' }, { value: 'percent' as const, label: 'Return %' }]} />
      </div>}
      <LegendInline>{shown.map((line) => <LegendKey key={line.key} color={line.color}
        dashed={line.dashed || line.key === 'invested'}>
        {line.label}: {legendValue(line)}
      </LegendKey>)}</LegendInline>
      <div className={styles.chart} ref={box}>
        <svg ref={svg} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img" aria-label={label} onPointerLeave={() => setAt(null)}>
          {area && <defs>
            <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={WORTH} stopOpacity="0.22" />
              <stop offset="100%" stopColor={WORTH} stopOpacity="0" />
            </linearGradient>
          </defs>}
          {Array.from({ length: Math.round((scale.top - scale.bottom) / scale.step) + 1 }, (_, index) => {
            const tick = scale.bottom + index * scale.step;
            const zero = !showValue && Math.abs(tick) < scale.step / 10;
            return <g key={index}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)}
                stroke={zero ? 'var(--line-strong)' : 'var(--grid)'} strokeWidth={zero ? 1.5 : 1} />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">
                {showValue ? axisLabel(tick) : formatAxisPercent(tick, scale.step)}
              </text>
            </g>;
          })}
          {dates.map((date, index) => labelIndexes.has(index) && <g key={date}>
            <line x1={x(index)} x2={x(index)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} stroke="var(--grid)" />
            <text x={x(index)} y={HEIGHT - 8} textAnchor="middle">{span > 365 ? shortMonthLabel(monthOf(date)) : formatDay(date)}</text>
          </g>)}
          {area && <path d={area} fill={`url(#${fill})`} stroke="none" />}
          {showValue && <path d={stepPath(pointsOf(value.invested))} fill="none" stroke={INVESTED}
            strokeWidth={1.5} strokeDasharray="4 3" />}
          {shown.filter((line) => line.key !== 'invested').map((line) => <path key={line.key}
            d={smoothPath(pointsOf(line.values))} fill="none" stroke={line.color}
            strokeWidth={line.dashed ? 1.8 : 2.3} strokeDasharray={line.dashed ? '6 4' : undefined}
            strokeLinejoin="round" strokeLinecap="round" />)}
          {dates.length === 1 && dots.map((line) => line.values[0] !== null &&
            <circle key={line.key} cx={x(0)} cy={y(unitOf(line.values[0]!))} r="4" fill={line.color} />)}
          {at !== null && <line x1={x(at)} x2={x(at)} y1={MARGIN.top} y2={MARGIN.top + innerHeight}
            stroke="var(--line-strong)" strokeDasharray="3 3" />}
          {at !== null && dots.map((line) => line.values[at] !== null && line.values[at] !== undefined &&
            <circle key={line.key} cx={x(at)} cy={y(unitOf(line.values[at]!))} r="4" fill={line.color}
              stroke="var(--surface)" strokeWidth="2" />)}
          <rect x={MARGIN.left} y={MARGIN.top} width={Math.max(0, innerWidth)} height={innerHeight}
            fill="transparent" onPointerMove={move} onPointerDown={move} />
        </svg>
        <Tip state={tip} boxWidth={width} />
      </div>
    </>
  );
}
