import Link from 'next/link';
import { IconLink } from '@/components/Button/Button';
import { addMonths, monthLabel, type IsoMonth } from '@/lib/domain/dates';
import styles from './MonthPicker.module.css';

/** The month name between previous and next links. The month itself lives in the URL. */
export function MonthPicker({
  month,
  current,
  href,
}: {
  month: IsoMonth;
  current: IsoMonth;
  href: (month: IsoMonth) => string;
}) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <nav className={styles.picker} aria-label="Month">
      <IconLink icon="chevLeft" label={`Previous month, ${monthLabel(prev)}`} href={href(prev)} />
      <h2 className={styles.month} aria-live="polite">
        {monthLabel(month)}
      </h2>
      <IconLink icon="chevRight" label={`Next month, ${monthLabel(next)}`} href={href(next)} />
      {month !== current && (
        <Link className="linkish" href={href(current)}>
          Back to this month
        </Link>
      )}
    </nav>
  );
}
