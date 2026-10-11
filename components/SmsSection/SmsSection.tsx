'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { IconButton } from '@/components/Button/Button';
import { PairPhoneButton } from '@/components/SmsPairing/SmsPairing';
import styles from './SmsSection.module.css';

/** The heading over every SMS view: whether a phone is connected, and the two section actions. */
export function SmsSectionHead({ status }: { status: { text: string; connected: boolean } }) {
  const router = useRouter();
  const [checking, startChecking] = useTransition();

  return (
    <div className={styles.head}>
      <div className={styles.title}>
        <h2>SMS imports</h2>
        <p className={styles.status}>
          <span
            className={styles.dot}
            data-connected={status.connected || undefined}
            aria-hidden="true"
          />
          {status.text}
        </p>
      </div>
      <div className={styles.actions}>
        <IconButton
          icon="refresh"
          label="Check for new SMS"
          soft
          disabled={checking}
          aria-busy={checking || undefined}
          onClick={() => startChecking(() => router.refresh())}
        />
        <PairPhoneButton variant="secondary" />
      </div>
    </div>
  );
}
