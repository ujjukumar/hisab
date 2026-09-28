import type { ReactNode } from 'react';
import { StatStrip, type Stat } from '@/components/StatStrip/StatStrip';
import styles from './PageHead.module.css';

/** The white band at the top of every page: title, actions, an optional stat strip and tabs. */
export function PageHead({
  title,
  actions,
  stats,
  statsVariant,
  tabs,
}: {
  title: ReactNode;
  actions?: ReactNode;
  stats?: Stat[];
  statsVariant?: 'three';
  tabs?: ReactNode;
}) {
  const bare = !stats && !tabs;
  return (
    <div className={`${styles.head} ${bare ? styles.noStrip : ''}`}>
      <div className="wrap">
        <div className={styles.row}>
          <h1 className={styles.title}>{title}</h1>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        {stats && <StatStrip stats={stats} variant={statsVariant} />}
        {tabs}
      </div>
    </div>
  );
}
