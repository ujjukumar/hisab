'use client';

import { useActionState, useMemo, useState } from 'react';
import { encode } from 'uqr';
import { Button } from '@/components/Button/Button';
import { createSmsPairingInvite, type SmsPairingInviteResult } from '@/lib/actions/sms';
import styles from './SmsPairing.module.css';

/** Blank modules around the code. Scanners expect four on every side. */
const QUIET_ZONE = 4;

const expiryTime = new Intl.DateTimeFormat('en-IN', {
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** Every press asks for a fresh code, so the previous state and form data are not needed. */
const showCode = (): Promise<SmsPairingInviteResult | null> => createSmsPairingInvite();

/** One path for all dark modules: a rectangle per run of dark modules in each row. */
function modulesPath(rows: boolean[][]): string {
  let path = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x += 1;
      const run = x - start + 1;
      path += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`;
    }
  });
  return path;
}

/** Black on white in every theme, so a phone camera can read it in dark mode too. */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 0 });
    return { size: qr.size + QUIET_ZONE * 2, path: modulesPath(qr.data) };
  }, [value]);
  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      width={240}
      height={240}
      role="img"
      aria-label="QR code for pairing a phone with Hisaab"
      shapeRendering="crispEdges"
    >
      <rect className={styles.qrLight} width={size} height={size} />
      <path className={styles.qrDark} d={path} />
    </svg>
  );
}

/**
 * The one-time pairing code for Money -> SMS. The secret lives only in this component's
 * state: Hisaab keeps its hash, so reloading the page means showing a new code.
 */
export function SmsPairing() {
  const [state, action, isPending] = useActionState(showCode, null);
  const [copy, setCopy] = useState<{ link: string; ok: boolean } | null>(null);
  const link = state?.ok ? state.link : '';
  const copyResult = link && copy?.link === link ? copy : null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy({ link, ok: true });
    } catch {
      setCopy({ link, ok: false });
    }
  }

  return (
    <div className={styles.pairing}>
      {state?.ok && (
        <>
          <QrCode value={state.link} />
          <p className={styles.hint}>
            Scan it in SMS Organiser → ⋮ → Hisaab, or paste the link there. The code works once and
            expires in 10 minutes.
          </p>
          <div className={styles.linkRow}>
            <label className={styles.field}>
              Pairing link
              <input
                className={styles.link}
                value={state.link}
                readOnly
                autoComplete="off"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <Button variant="secondary" onClick={copyLink}>
              {copyResult?.ok ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className={styles.expiry}>
            Expires at{' '}
            <time dateTime={state.expiresAt}>{expiryTime.format(new Date(state.expiresAt))}</time>
          </p>
          {copyResult && !copyResult.ok && (
            <p className={styles.feedback} role="alert">
              The link could not be copied. Select it and copy it yourself.
            </p>
          )}
          <span className="sr-only" role="status">
            {copyResult?.ok ? 'Pairing link copied' : ''}
          </span>
        </>
      )}
      {state && !state.ok && (
        <p className={styles.feedback} role="alert">
          {state.message}
        </p>
      )}
      <form action={action}>
        <Button type="submit" variant={state?.ok ? 'secondary' : 'primary'} disabled={isPending}>
          {isPending ? 'Creating code…' : state?.ok ? 'Show a new code' : 'Show pairing code'}
        </Button>
      </form>
    </div>
  );
}
