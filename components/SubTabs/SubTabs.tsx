import Link from 'next/link';
import styles from './SubTabs.module.css';

export type SubTab = { href: string; label: string; key: string };

/** The uppercase jump-link row under a page head, used for the investment groups. */
export function SubTabs({
  items,
  current,
  label = 'Groups',
}: {
  items: SubTab[];
  current?: string;
  label?: string;
}) {
  return (
    <div className={styles.subtabs}>
      <nav className={`wrap ${styles.inner}`} aria-label={label}>
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === current ? 'true' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
