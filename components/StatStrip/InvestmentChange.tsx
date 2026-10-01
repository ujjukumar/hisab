'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatINRSigned, formatPercent, gainClass } from '@/lib/domain/format';
import { PERIOD_LABELS, PERIODS, type Period } from '@/lib/domain/performance';
import styles from './StatStrip.module.css';

export function InvestmentChange({
  changes,
}: {
  changes: { period: Period; gain: number; absolute: number | null }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const selected = changes.find(({ period }) => period === params.get('period')) ?? changes[0]!;
  const tone = gainClass(selected.gain);

  return (
    <span className={styles.periodChange}>
      <span className={`${styles.periodGroup} ${tone}`}>
        {formatINRSigned(selected.gain)}
        <span className={`${styles.aside} ${tone}`}>
          {selected.absolute === null ? '—' : formatPercent(selected.absolute * 100)}
        </span>
      </span>
      <select
        className={styles.periodSelect}
        aria-label="Investment change period"
        value={selected.period}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          if (event.target.value === '1d') next.delete('period');
          else next.set('period', event.target.value);
          const query = next.toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }}
      >
        {PERIODS.map((period) => (
          <option key={period} value={period}>
            {PERIOD_LABELS[period]}
          </option>
        ))}
      </select>
    </span>
  );
}