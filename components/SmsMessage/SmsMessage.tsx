import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconLink } from '@/components/Button/Button';
import { Icon } from '@/components/Icon/Icon';
import type { SmsHighlightKind } from '@/lib/domain/sms';
import styles from './SmsMessage.module.css';

const KIND_LABELS: Record<SmsHighlightKind, string> = {
  amount: 'Amount',
  direction: 'Money in or out',
  date: 'Date',
  reference: 'Reference',
  merchant: 'Merchant',
};

export type SmsSegment = { text: string; kind: SmsHighlightKind | null };

/**
 * One pending SMS as the owner sees it before deciding: who sent it, the original
 * text with the parts Hisaab read underlined, and why it needs a look.
 * `children` is the review form.
 */
export function SmsMessage({
  sender,
  meta,
  position,
  prevHref,
  nextHref,
  backHref,
  backLabel,
  segments,
  bodyError,
  reason,
  children,
}: {
  sender: string;
  /** 'Received 11 Oct 2026, 9:42 am', 'via Pixel 8', 'Ref 6281…' */
  meta: string[];
  /** 1-based place in the current queue, or null when the message is filtered out. */
  position: { index: number; total: number } | null;
  prevHref: string | null;
  nextHref: string | null;
  /** The list link shown above the message on phones. */
  backHref: string;
  backLabel: string;
  segments: SmsSegment[] | null;
  bodyError: string | null;
  reason: string | null;
  children: ReactNode;
}) {
  return (
    <article className={styles.message} aria-labelledby="sms-sender">
      <Link className={styles.back} href={backHref} scroll={false}>
        <Icon name="chevLeft" />
        {backLabel}
      </Link>
      <header className={styles.head}>
        <div className={styles.who}>
          <h3 className={styles.sender} id="sms-sender">
            {sender}
          </h3>
          <p className={styles.meta}>
            {meta.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </p>
        </div>
        {position && (
          <nav className={styles.pager} aria-label="Pending SMS">
            <span className={styles.position}>
              {position.index} of {position.total}
            </span>
            {prevHref ? (
              <IconLink icon="chevLeft" label="Previous SMS" href={prevHref} />
            ) : (
              <span className={styles.pagerOff} aria-hidden="true">
                <Icon name="chevLeft" />
              </span>
            )}
            {nextHref ? (
              <IconLink icon="chevRight" label="Next SMS" href={nextHref} />
            ) : (
              <span className={styles.pagerOff} aria-hidden="true">
                <Icon name="chevRight" />
              </span>
            )}
          </nav>
        )}
      </header>

      <section className={styles.original} aria-labelledby="sms-original">
        <div className={styles.originalHead}>
          <h4 id="sms-original">Original SMS</h4>
          {segments?.some((segment) => segment.kind) && (
            <span className={styles.legend}>
              <span className={styles.legendMark} aria-hidden="true">
                abc
              </span>{' '}
              Underlined = read by Hisaab
            </span>
          )}
        </div>
        {segments ? (
          <p className={styles.body}>
            {segments.map((segment, i) =>
              segment.kind ? (
                <mark key={i} className={styles.read} title={KIND_LABELS[segment.kind]}>
                  {segment.text}
                </mark>
              ) : (
                segment.text
              ),
            )}
          </p>
        ) : (
          <p className={styles.bodyError} role="alert">
            <Icon name="alert" />
            <span>{bodyError}</span>
          </p>
        )}
      </section>

      {reason && (
        <p className={styles.reason}>
          <strong>Why review?</strong> {reason}
        </p>
      )}

      {children}
    </article>
  );
}

/** The detail pane when no message is open. */
export function SmsMessageEmpty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
