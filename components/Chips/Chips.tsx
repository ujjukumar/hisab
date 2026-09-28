'use client';

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
