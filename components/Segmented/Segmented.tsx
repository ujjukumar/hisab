'use client';

import styles from './Segmented.module.css';

/** The income / spending / transfer switch at the top of the transaction drawer. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  name,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** When given, the current value is also submitted with the form. */
  name?: string;
}) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
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
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
