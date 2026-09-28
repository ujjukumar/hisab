'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Tabs.module.css';

export type Tab = { href: string; label: string };

/** The underlined tab row at the bottom of a page head. Each tab is a real link. */
export function Tabs({ tabs, label = 'Sections' }: { tabs: Tab[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav className={styles.tabs} aria-label={label} role="tablist">
      {tabs.map((tab) => {
        const selected = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
