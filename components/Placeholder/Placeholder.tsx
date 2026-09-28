import type { ReactNode } from 'react';
import { Card } from '@/components/Card/Card';
import styles from './Placeholder.module.css';

/** Stands in for a page body until its phase builds it. */
export function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap page-body">
      <div className="grid">
        <Card span={12} title={title} className={styles.placeholder}>
          <p>{children}</p>
        </Card>
      </div>
    </div>
  );
}
