'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import styles from './StatStrip.module.css';

export function NetWorthPeriodSelect({
  period,
  options,
}: {
  period: string;
  options: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <select
      className={styles.periodSelect}
      aria-label="Net worth change period"
      value={period}
      onChange={(event) => {
        const next = new URLSearchParams(params.toString());
        if (event.target.value === '1d') next.delete('worth');
        else next.set('worth', event.target.value);
        const query = next.toString();
        router.replace(query ? `/?${query}` : '/', { scroll: false });
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}