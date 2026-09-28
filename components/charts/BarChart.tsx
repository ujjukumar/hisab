'use client';

import { useRef, useState } from 'react';
import { axisLabel, formatINR, formatINRSigned, niceScale } from '@/lib/domain/format';
import styles from './Chart.module.css';
import { Tip, type TipState } from './Tip';
import { useWidth } from './useWidth';

export type BarRow = {
  /** Short month name, e.g. 'Sep'. */
  month: string;
  /** Year, shown in the tooltip. */
  year: string;
  /** Paise. */
  income: number;
  /** Paise. */
  spending: number;
};

const H = 250;
const M = { l: 44, r: 4, t: 12, b: 28 };

/** Paired income and spending bars per month. */
export function BarChart({ rows }: { rows: BarRow[] }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [tip, setTip] = useState<TipState>(null);

  if (rows.length === 0) {
    return <div className={styles.empty}>No months to show yet</div>;
  }

  const iw = width - M.l - M.r;
  const ih = H - M.t - M.b;
  const peak = Math.max(...rows.map((r) => Math.max(r.income, r.spending))) / 100;
  const sc = niceScale(peak, 4);
  const y = (rupees: number) => M.t + ih - (rupees / sc.top) * ih;
  const gw = iw / rows.length;
  const bw = Math.max(5, Math.min(18, gw * 0.3));

  return (
    <div className={styles.chart} ref={box}>
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label="Bar chart of monthly income and spending"
        onPointerLeave={() => setTip(null)}
      >
        {Array.from({ length: sc.ticks + 1 }, (_, k) => {
          const v = sc.step * k;
          const yy = y(v);
          return (
            <g key={k}>
              <line x1={M.l} x2={width - M.r} y1={yy} y2={yy} stroke="var(--grid)" />
              <text x={M.l - 8} y={yy + 4} textAnchor="end">
                {axisLabel(v)}
              </text>
            </g>
          );
        })}

        {rows.map((r, i) => {
          const cx = M.l + gw * i + gw / 2;
          const dim = tip !== null && tip.title !== `${r.month} ${r.year}`;
          return (
            <g
              key={`${r.year}-${r.month}`}
              className={styles.group}
              style={{ opacity: dim ? 0.4 : 1 }}
              onPointerEnter={() =>
                setTip({
                  x: cx,
                  y: M.t + 4,
                  title: `${r.month} ${r.year}`,
                  rows: [
                    { color: 'var(--c1)', label: 'Income', value: formatINR(r.income) },
                    { color: 'var(--c3)', label: 'Spending', value: formatINR(r.spending) },
                    {
                      label: 'Saved',
                      // Minus when overspent, but no plus sign when saved.
                      value:
                        r.income < r.spending
                          ? formatINRSigned(r.income - r.spending)
                          : formatINR(r.income - r.spending),
                    },
                  ],
                })
              }
            >
              <rect
                x={cx - bw - 1.5}
                y={y(r.income / 100)}
                width={bw}
                height={M.t + ih - y(r.income / 100)}
                fill="var(--c1)"
                rx="1.5"
              />
              <rect
                x={cx + 1.5}
                y={y(r.spending / 100)}
                width={bw}
                height={M.t + ih - y(r.spending / 100)}
                fill="var(--c3)"
                rx="1.5"
              />
              {(gw >= 34 || i % 2 === rows.length % 2) && (
                <text x={cx} y={H - 8} textAnchor="middle">
                  {r.month}
                </text>
              )}
              <rect x={M.l + gw * i} y={M.t} width={gw} height={ih} fill="transparent" />
            </g>
          );
        })}
      </svg>
      <Tip state={tip} boxWidth={width} />
    </div>
  );
}
