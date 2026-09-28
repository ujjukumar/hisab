import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './Card.module.css';

/** A titled panel. `span` is the grid width in twelfths (4, 5, 7, 8 or 12). */
export function Card({
  title,
  sub,
  action,
  span,
  footer,
  className = '',
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  span?: 4 | 5 | 7 | 8 | 12;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`${styles.card} ${span ? `s${span}` : ''} ${className}`}>
      {(title || action) && (
        <div className={styles.head}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {sub && <p className={styles.sub}>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
      {footer && <div className={styles.foot}>{footer}</div>}
    </article>
  );
}

/** The 'See all ›' link used in card footers. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className={styles.moreLink} href={href}>
      {children}
      <Icon name="chevRight" />
    </Link>
  );
}
