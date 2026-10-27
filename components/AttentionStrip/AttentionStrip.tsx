import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { Icon } from '@/components/Icon/Icon';
import { PayCardButton } from '@/components/TransactionDrawer/TransactionDrawer';
import type { AttentionItem } from '@/lib/domain/attention';
import styles from './AttentionStrip.module.css';

/**
 * The Dashboard's "Needs you" rail: each thing the owner can put right, with the one
 * action that does it. Card bills open a filled-in payment; the rest link to the page
 * that fixes them. A quiet week says so in one line.
 */
export function NeedsYou({
  items,
  payFrom,
}: {
  items: AttentionItem[];
  /** The account a card bill is paid from by default: the first bank account. */
  payFrom: number | null;
}) {
  return (
    <Card title="Needs you" span={4} className={styles.rail}>
      {items.length === 0 ? (
        <p className={styles.quiet}>Nothing needs you right now.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.key}>
              <span className={item.tone === 'neg' ? 'neg' : undefined}>{item.text}</span>
              {item.pay ? (
                <PayCardButton
                  cardId={item.pay.accountId}
                  cardName={item.pay.name}
                  fromId={payFrom}
                  amount={item.pay.amount}
                />
              ) : (
                <Link className={styles.action} href={item.href}>
                  {item.action}
                  <Icon name="chevRight" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
