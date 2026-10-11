import Link from 'next/link';
import { Icon } from '@/components/Icon/Icon';
import type { AttentionItem } from '@/lib/domain/attention';
import styles from './AttentionStrip.module.css';

/**
 * The short list of things the owner can put right, above the dashboard grid.
 * Renders nothing when there is nothing to say, so a quiet month stays quiet.
 */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.strip} aria-labelledby="needs-attention">
      <h2 id="needs-attention" className={styles.heading}>
        <Icon name="alert" className={styles.icon} />
        Needs attention
      </h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key}>
            <Link className={styles.item} href={item.href}>
              <span className={item.tone === 'neg' ? 'neg' : undefined}>{item.text}</span>
              <span className={styles.action}>
                {item.action}
                <Icon name="chevRight" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
