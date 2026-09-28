'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './Chart.module.css';

export type TipState = { x: number; y: number; title: string; rows: TipRowData[] } | null;

export type TipRowData = { color?: string; label: string; value: string; tone?: 'pos' | 'neg' | '' };

/** The hover card used by both charts. It flips to the left when it would overflow. */
export function Tip({ state, boxWidth }: { state: TipState; boxWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    let left = state.x + 14;
    if (left + el.offsetWidth > boxWidth) left = state.x - el.offsetWidth - 14;
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${state.y}px`;
  }, [state, boxWidth]);

  return (
    <div ref={ref} className={`${styles.tip} ${state ? styles.show : ''}`} aria-hidden="true">
      {state && (
        <>
          <b>{state.title}</b>
          {state.rows.map((row) => (
            <TipRow key={row.label} {...row} />
          ))}
        </>
      )}
    </div>
  );
}

function TipRow({ color, label, value, tone }: TipRowData) {
  return (
    <div className={styles.tipRow}>
      <span>
        {color && <i className="dot" style={{ background: color }} />}
        {label}
      </span>
      <span className={`${styles.v} ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

/** The small colour key above a chart. */
export function LegendInline({ children }: { children: ReactNode }) {
  return <div className={styles.legendInline}>{children}</div>;
}

export function LegendKey({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span>
      <i className="dot" style={{ background: color }} aria-hidden="true" />
      {children}
    </span>
  );
}
