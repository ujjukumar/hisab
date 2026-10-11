'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { PairPhoneButton } from '@/components/SmsPairing/SmsPairing';
import { useToast } from '@/components/Toast/Toast';
import { manageSmsDeviceFormAction } from '@/lib/actions/sms';
import type { SmsDeviceState } from '@/lib/domain/smsReview';
import styles from './SmsDevices.module.css';

export type SmsRequestItem = { id: number; label: string; code: string | null; requested: string };

export type SmsPhoneItem = {
  id: number;
  label: string;
  state: SmsDeviceState;
  status: string;
  /** Short lines such as 'Last SMS today 10:05 am', '12 SMS this week', 'Paired 9 Oct'. */
  meta: string[];
};

type Intent = 'approve' | 'reject' | 'revoke';

function useDeviceAction() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  function run(id: number, intent: Intent, done?: () => void) {
    setError('');
    start(async () => {
      const data = new FormData();
      data.set('id', String(id));
      data.set('intent', intent);
      const result = await manageSmsDeviceFormAction(null, data);
      if (!result) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      done?.();
      toast(result.message);
    });
  }
  return { pending, error, run };
}

/** Phones that send SMS to Hisaab, and requests from phones that want to. */
export function SmsDevices({
  requests,
  phones,
  revoked,
}: {
  requests: SmsRequestItem[];
  phones: SmsPhoneItem[];
  revoked: SmsPhoneItem[];
}) {
  return (
    <>
      {requests.length > 0 && (
        <Card
          title={`Waiting to connect (${requests.length})`}
          sub="Check that the code matches the one on the phone before you approve it."
        >
          <ul className={styles.list}>
            {requests.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={`Phones (${phones.length})`}
        sub="Revoke a phone if it is lost or its token may be exposed. It stops sending SMS at once."
        action={phones.length > 0 ? <PairPhoneButton variant="secondary" /> : undefined}
      >
        {phones.length === 0 ? (
          <div className={styles.empty}>
            <p>
              No phone is paired. Pair your Android phone to send bank SMS to Hisaab for review.
            </p>
            <PairPhoneButton />
          </div>
        ) : (
          <ul className={styles.list}>
            {phones.map((phone) => (
              <PhoneRow key={phone.id} phone={phone} />
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <details className={styles.revoked}>
            <summary>Show revoked ({revoked.length})</summary>
            <ul className={styles.list}>
              {revoked.map((phone) => (
                <li key={phone.id} className={styles.row}>
                  <div className={styles.info}>
                    <strong className={styles.name}>{phone.label}</strong>
                    <p className={styles.meta}>
                      {phone.meta.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </>
  );
}

function RequestRow({ request }: { request: SmsRequestItem }) {
  const { pending, error, run } = useDeviceAction();
  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <strong className={styles.name}>{request.label}</strong>
        <p className={styles.meta}>
          <span>Requested {request.requested}</span>
        </p>
        {request.code && (
          <p className={styles.code}>
            <span className={styles.codeLabel}>Code</span>
            <span className={styles.codeValue}>{request.code}</span>
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button disabled={pending} onClick={() => run(request.id, 'approve')}>
          Approve phone<span className="sr-only"> {request.label}</span>
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(request.id, 'reject')}>
          Reject request<span className="sr-only"> from {request.label}</span>
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function PhoneRow({ phone }: { phone: SmsPhoneItem }) {
  const { pending, error, run } = useDeviceAction();
  const [confirming, setConfirming] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (confirming || !refocus.current) return;
    refocus.current = false;
    actions.current?.querySelector('button')?.focus();
  }, [confirming]);

  function cancel() {
    refocus.current = true;
    setConfirming(false);
  }

  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <strong className={styles.name}>{phone.label}</strong>
        <p className={styles.status}>
          <span className={styles.dot} data-state={phone.state} aria-hidden="true" />
          {phone.status}
        </p>
        <p className={styles.meta}>
          {phone.meta.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </div>
      <div className={styles.actions} ref={actions}>
        {confirming ? (
          <div className={styles.confirm} role="group" aria-label={`Revoke ${phone.label}`}>
            <span>Revoke {phone.label}? It stops sending SMS right away.</span>
            <Button
              disabled={pending}
              autoFocus
              onClick={() => run(phone.id, 'revoke', () => setConfirming(false))}
            >
              Revoke phone
            </Button>
            <Button variant="secondary" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Revoke<span className="sr-only"> {phone.label}</span>
          </Button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
