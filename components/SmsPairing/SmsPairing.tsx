'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { encode } from 'uqr';
import { Button } from '@/components/Button/Button';
import { Drawer } from '@/components/Drawer/Drawer';
import {
  createSmsPairingInvite,
  smsPairingInviteStatus,
  type SmsPairingInviteResult,
} from '@/lib/actions/sms';
import styles from './SmsPairing.module.css';

/** Blank modules around the code. Scanners expect four on every side. */
const QUIET_ZONE = 4;
const POLL_MS = 3000;

const expiryTime = new Intl.DateTimeFormat('en-IN', {
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

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
      width={220}
      height={220}
      role="img"
      aria-label="QR code for pairing a phone with Hisaab"
      shapeRendering="crispEdges"
    >
      <rect className={styles.qrLight} width={size} height={size} />
      <path className={styles.qrDark} d={path} />
    </svg>
  );
}

const PairingContext = createContext<() => void>(() => {});

/** Opens the pair-a-phone drawer from anywhere inside Money -> SMS. */
export function usePairPhone() {
  return useContext(PairingContext);
}

export function PairPhoneButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const open = usePairPhone();
  return (
    <Button variant={variant} icon="plus" onClick={open}>
      Pair a phone
    </Button>
  );
}

type Status = { status: 'waiting' } | { status: 'used'; label: string } | { status: 'expired' };

/**
 * Holds the pairing drawer for the SMS section. Each opening shows a fresh one-time code:
 * Hisaab keeps only its hash, so the secret lives in this component's state alone.
 */
export function SmsPairingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<SmsPairingInviteResult | null>(null);
  const [status, setStatus] = useState<Status>({ status: 'waiting' });
  const [msLeft, setMsLeft] = useState(0);
  const [creating, startCreating] = useTransition();

  function newCode() {
    setStatus({ status: 'waiting' });
    startCreating(async () => {
      const result = await createSmsPairingInvite();
      setInvite(result);
      if (result.ok) setMsLeft(Date.parse(result.expiresAt) - Date.now());
    });
  }

  function show() {
    setOpen(true);
    newCode();
  }

  function close() {
    setOpen(false);
    setInvite(null);
  }

  const inviteId = invite?.ok ? invite.inviteId : null;
  const expiresAt = invite?.ok ? invite.expiresAt : null;
  const waiting = open && inviteId !== null && status.status === 'waiting';

  // Ask every few seconds whether the phone has used the code, only while the drawer is open.
  useEffect(() => {
    if (!waiting || inviteId === null || !expiresAt) return;
    let stopped = false;
    const tick = window.setInterval(() => setMsLeft(Date.parse(expiresAt) - Date.now()), 1000);
    const poll = window.setInterval(async () => {
      try {
        const next = await smsPairingInviteStatus(inviteId);
        if (stopped || next.status === 'waiting') return;
        setStatus(next);
        if (next.status === 'used') router.refresh();
      } catch {
        // Hisaab is restarting or the tab lost the server; the next poll tries again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [waiting, inviteId, expiresAt, router]);

  const expired = status.status === 'expired' || (waiting && msLeft <= 0 && !creating);
  const connected = status.status === 'used';

  return (
    <PairingContext.Provider value={show}>
      {children}
      <Drawer
        open={open}
        onClose={close}
        title="Pair a phone"
        footer={
          connected ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <Button variant="secondary" onClick={newCode} disabled={creating}>
              {creating ? 'Creating code…' : 'Show a new code'}
            </Button>
          )
        }
      >
        <ol className={styles.steps} data-done={connected || undefined}>
          {[
            'On the phone, open SMS Organiser → ⋮ → Hisaab.',
            'Scan the code below, or paste the pairing link.',
            'Hisaab shows the phone here once it connects.',
          ].map((label, i) => (
            <li key={label}>
              <span className={styles.stepNo} aria-hidden="true">
                {i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {status.status === 'used' ? (
          <p className={styles.connected} role="status">
            <span className={styles.okDot} aria-hidden="true" />
            <strong>{status.label} connected.</strong> New SMS from this phone will appear in
            Review.
          </p>
        ) : invite && !invite.ok ? (
          <p className={styles.feedback} role="alert">
            {invite.message}
          </p>
        ) : invite?.ok && !expired ? (
          <PairingCode link={invite.link} expiresAt={invite.expiresAt} msLeft={msLeft} />
        ) : expired ? (
          <p className={styles.feedback} role="alert">
            This code has expired. Show a new code to pair your phone.
          </p>
        ) : (
          <p className={styles.waiting} role="status">
            Creating a code…
          </p>
        )}
      </Drawer>
    </PairingContext.Provider>
  );
}

function PairingCode({
  link,
  expiresAt,
  msLeft,
}: {
  link: string;
  expiresAt: string;
  msLeft: number;
}) {
  const [copy, setCopy] = useState<{ link: string; ok: boolean } | null>(null);
  const copyResult = copy?.link === link ? copy : null;
  const minutes = Math.ceil(msLeft / 60_000);

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
      <QrCode value={link} />
      <div className={styles.linkRow}>
        <label className={styles.field}>
          Pairing link
          <input
            className={styles.link}
            value={link}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <Button variant="secondary" onClick={copyLink}>
          {copyResult?.ok ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className={styles.expiry}>
        Works once. Expires at{' '}
        <time dateTime={expiresAt}>{expiryTime.format(new Date(expiresAt))}</time>
        {msLeft > 0 && ` (${minutes <= 1 ? 'less than a minute' : `${minutes} min`} left)`}
      </p>
      <p className={styles.waiting} role="status">
        <span className={styles.pulse} aria-hidden="true" />
        Waiting for your phone…
      </p>
      {copyResult && !copyResult.ok && (
        <p className={styles.feedback} role="alert">
          The link could not be copied. Select it and copy it yourself.
        </p>
      )}
      <span className="sr-only" role="status">
        {copyResult?.ok ? 'Pairing link copied' : ''}
      </span>
    </div>
  );
}
