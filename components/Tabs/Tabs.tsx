'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Tabs.module.css';

export type Tab = {
  href: string;
  label: string;
  /** A small badge after the label. Hidden at zero. */
  count?: number;
  /** Read after the count by screen readers, e.g. 'waiting for review'. */
  countLabel?: string;
  /** Also select the tab on pages below `href`, such as /money/sms/rules for /money/sms. */
  match?: 'prefix';
  /** Kept on the link, such as the year both Tax tabs show. */
  query?: string;
};

/**
 * The underlined tab row at the bottom of a page head. Each tab is a real link.
 * `view` is the smaller uppercase row that switches views inside one section.
 */
export function Tabs({
  tabs,
  label = 'Sections',
  variant = 'page',
}: {
  tabs: Tab[];
  label?: string;
  variant?: 'page' | 'view';
}) {
  const pathname = usePathname();
  return (
    <nav
      className={`${styles.tabs} ${variant === 'view' ? styles.view : ''}`}
      aria-label={label}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected =
          pathname === tab.href || (tab.match === 'prefix' && pathname.startsWith(`${tab.href}/`));
        return (
          <Link
            key={tab.href}
            href={tab.query ? `${tab.href}?${tab.query}` : tab.href}
            role="tab"
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
          >
            {tab.label}
            {tab.count ? (
              <span className={styles.count}>
                <span aria-hidden="true">{tab.count}</span>
                <span className="sr-only">
                  {`, ${tab.count}${tab.countLabel ? ` ${tab.countLabel}` : ''}`}
                </span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
