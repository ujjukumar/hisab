'use client';

import Link from 'next/link';
import styles from './Chips.module.css';

export type Chip<T extends string> = { value: T; label: string };

/** A small toggle group, used for chart ranges like 6M / 1Y. */
export function Chips<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Chip<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** The same chips as links, for filters kept in the URL. A count follows the label when given. */
export function ChipLinks({
  items,
  label,
}: {
  items: { href: string; label: string; count?: number; current: boolean }[];
  label: string;
}) {
  return (
    <nav className={`${styles.chips} ${styles.links}`} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.current ? 'true' : undefined}
          scroll={false}
        >
          {item.label}
          {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
