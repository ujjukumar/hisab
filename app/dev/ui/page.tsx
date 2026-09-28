import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Showcase } from './Showcase';
import styles from './ui.module.css';

export const metadata: Metadata = { title: 'Building blocks · Hisaab' };

/**
 * A development-only page showing every shared component side by side in both
 * themes, so changes can be checked against docs/mockup.html.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className={styles.panels}>
      <div className={styles.panel} data-theme="light">
        <p className={styles.panelHead}>Light</p>
        <Showcase />
      </div>
      <div className={styles.panel} data-theme="dark">
        <p className={styles.panelHead}>Dark</p>
        <Showcase />
      </div>
    </div>
  );
}
