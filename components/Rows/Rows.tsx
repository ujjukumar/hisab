import type { ReactNode } from 'react';
import styles from './Rows.module.css';

export type Row = {
  key: string;
  name: ReactNode;
  sub?: ReactNode;
  /** A coloured dot before the name, e.g. a category colour. */
  color?: string;
  amount: ReactNode;
  tone?: 'pos' | 'neg' | 'muted' | '';
  /** Draws a rule above the row, for a totals line. */
  total?: boolean;
};

/** The name / amount list used in the account, category and holdings cards. */
export function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <li key={row.key} className={row.total ? styles.total : undefined}>
          <span className={styles.main}>
            {row.color && <i className="dot" style={{ background: row.color }} aria-hidden="true" />}
            <span className={styles.text}>
              <span className={styles.name}>{row.name}</span>
              {row.sub && <span className={styles.sub}>{row.sub}</span>}
            </span>
          </span>
          <span className={`${styles.amt} ${row.tone ?? ''}`}>{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}
