import { formatINR } from '@/lib/domain/format';
import styles from './Chart.module.css';

export type Slice = { name: string; value: number; color: string };

/** A ring chart drawn with dash offsets, as in the mockup. `value` is in paise. */
export function Donut({
  items,
  label,
  size = 132,
  strokeWidth = 22,
}: {
  items: Slice[];
  label: string;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let acc = 0;

  return (
    <svg
      className={styles.donut}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
    >
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--track)" strokeWidth={strokeWidth} />
      {total > 0 &&
        items.map((item) => {
          const len = (item.value / total) * circumference;
          const gap = items.length > 1 && len > 3 ? 1.5 : 0;
          const offset = -acc;
          acc += len;
          return (
            <circle
              key={item.name}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${Math.max(0, len - gap)} ${circumference}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${c} ${c})`}
            >
              <title>{`${item.name}: ${formatINR(item.value)}`}</title>
            </circle>
          );
        })}
    </svg>
  );
}

/** The name and share list that sits beside a donut. */
export function LegendList({ items }: { items: Slice[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <ul className={styles.legendList}>
      {items.map((item) => (
        <li key={item.name}>
          <i className="dot" style={{ background: item.color }} aria-hidden="true" />
          <span>
            <span className={styles.nm}>{item.name}</span>
            <span className={styles.pc}>
              {total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0'}%
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Legend on the left, donut on the right. */
export function DonutSplit({
  items,
  label,
  size,
  strokeWidth,
}: {
  items: Slice[];
  label: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <div className={styles.split}>
      <LegendList items={items} />
      <Donut items={items} label={label} size={size} strokeWidth={strokeWidth} />
    </div>
  );
}
