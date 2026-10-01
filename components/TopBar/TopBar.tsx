'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/Icon/Icon';
import { PriceJobProgress } from '@/components/Prices/Prices';
import styles from './TopBar.module.css';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/money', label: 'Money' },
  { href: '/investments', label: 'Investments' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopBar({ sampleData = false }: { sampleData?: boolean }) {
  const pathname = usePathname();

  return (
    <header className={styles.topbar}>
      <div className={`wrap ${styles.inner}`}>
        <Link className={styles.brand} href="/" aria-label="Hisaab, go to dashboard">
          hisaab
          <i aria-hidden="true" />
        </Link>
        <nav className={styles.nav} aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          {sampleData && <span className={styles.pill}>Sample data</span>}
          <span className={styles.avatar} aria-hidden="true">
            <Icon name="user" />
          </span>
        </div>
      </div>
      <PriceJobProgress />
    </header>
  );
}
