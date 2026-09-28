import type { ReactNode } from 'react';
import styles from './StatStrip.module.css';

export type Stat = {
  label: string;
  value: ReactNode;
  /** Secondary figure shown beside (or under) the main one. */
  aside?: ReactNode;
  /** 'pos' or 'neg' colours the figures green or red. */
  tone?: 'pos' | 'neg' | '';
  asideTone?: 'pos' | 'neg' | '';
};

export function StatStrip({ stats, variant }: { stats: Stat[]; variant?: 'three' }) {
  return (
    <div className={`${styles.strip} ${variant === 'three' ? styles.three : ''}`}>
      {stats.map((stat) => (
        <div className={styles.stat} key={stat.label}>
          <p className={styles.label}>{stat.label}</p>
          <p className={styles.value}>
            <span className={`${styles.big} ${stat.tone ?? ''}`}>{stat.value}</span>
            {stat.aside !== undefined && (
              <span className={`${styles.aside} ${stat.asideTone ?? ''}`}>{stat.aside}</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
