'use client';

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button/Button';
import { useToast } from '@/components/Toast/Toast';
import { priceJobStatus, recheckMissingPrices, startPriceJob, stopPriceJob } from '@/lib/actions/priceJob';
import type { PriceJobStatus } from '@/lib/actions/priceJobStore';
import { refreshPrices, setAutoPrices } from '@/lib/actions/prices';
import type { IsoDate } from '@/lib/domain/dates';
import { formatDate } from '@/lib/domain/format';
import styles from './Prices.module.css';

/**
 * Asks the server for today's prices once when the app opens. The server skips it when prices
 * were already checked today or automatic prices are off; the page refreshes itself if any change.
 */
export function PriceRefresher() {
  const once = useRef(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    // A failure is shown on Investments and in Settings, so nothing to do here.
    refreshPrices(false)
      .then((r) => r?.ok && r.updated > 0 && setSaid('Prices updated'))
      .catch(() => {});
  }, []);
  return (
    <p className="sr-only" aria-live="polite">
      {said}
    </p>
  );
}

/** "Update now": fetch today's prices even if they were checked already. */
export function UpdatePricesButton({ link = false }: { link?: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const label = link ? 'Update now' : 'Update prices now';
  // aria-disabled rather than disabled, so keyboard focus stays on the button while it works.
  const onClick = () =>
    !pending &&
    start(async () => {
      const r = await refreshPrices(true);
      toast(r === null || r.ok ? 'Prices updated' : r.message);
    });
  return link ? (
    <button type="button" className="linkish" onClick={onClick} aria-disabled={pending}>
      {pending ? 'Updating…' : label}
    </button>
  ) : (
    <Button type="button" variant="secondary" onClick={onClick} aria-disabled={pending}>
      {pending ? 'Updating…' : label}
    </Button>
  );
}

export function AutoPricesSwitch({ on }: { on: boolean }) {
  const toast = useToast();
  const [checked, setChecked] = useState(on);
  const [pending, start] = useTransition();
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        aria-disabled={pending}
        onChange={(e) => {
          if (pending) return;
          const next = e.currentTarget.checked;
          setChecked(next);
          start(async () => {
            const r = await setAutoPrices(next);
            if (!r.ok) {
              setChecked(!next);
              toast(r.message);
            } else toast(next ? 'Automatic prices turned on' : 'Automatic prices turned off');
          });
        }}
      />
      Update prices when the app opens
    </label>
  );
}

export type PastDate = { date: IsoDate; funds: boolean; listed: boolean };

// Measured in September 2026: AMFI ~0.3 MB, NSE ~0.2 MB, BSE ~0.9 MB per day.
const size = (dates: PastDate[]) =>
  dates.reduce((mb, d) => mb + (d.funds ? 0.3 : 0) + (d.listed ? 1.1 : 0), 0);

type JobContextValue = {
  status: PriceJobStatus | null;
  busy: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

const JobContext = createContext<JobContextValue | null>(null);

export function PriceJobProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<PriceJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollTrigger, setPollTrigger] = useState(0);
  const previous = useRef<PriceJobStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await priceJobStatus();
        if (!mounted) return;
        const last = previous.current;
        previous.current = next;
        setStatus(next);
        if (last && (last.state === 'running' || last.state === 'stopping') &&
          next?.state !== 'running' && next?.state !== 'stopping') {
          router.refresh();
          toast(next?.state === 'failed' || (next?.state === 'done' && next.message) ? next.message
            : next?.state === 'stopped' ? 'Past prices stopped' : 'Past prices fetched');
        }
        if (next?.state === 'running' || next?.state === 'stopping') {
          timer = setTimeout(() => void poll(), 2500);
        }
      } catch {
        // Retry a transient local-server failure without polling while idle.
        if (mounted) timer = setTimeout(() => void poll(), 2500);
      }
    }
    void poll();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollTrigger, router, toast]);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await startPriceJob());
      setPollTrigger((value) => value + 1);
    } catch {
      toast("Past prices couldn't be started. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await stopPriceJob());
      setPollTrigger((value) => value + 1);
    } catch {
      toast("Past prices couldn't be stopped. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <JobContext.Provider value={{ status, busy, start, stop }}>{children}</JobContext.Provider>;
}

function usePriceJob() {
  const job = useContext(JobContext);
  if (!job) throw new Error('PriceJobProvider is missing');
  return job;
}

export function PriceJobProgress() {
  const { status, busy, stop } = usePriceJob();
  if (!status || (status.state !== 'running' && status.state !== 'stopping')) return null;
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      <div className={`wrap ${styles.progressInner}`}>
        <span>{status.state === 'stopping' ? 'Stopping past prices…' :
          status.date ? `Fetching ${formatDate(status.date)} (${status.done + 1} of ${Math.max(1, status.total)})` : 'Preparing past prices…'}</span>
        <progress value={status.done} max={Math.max(1, status.total)} aria-label="Past prices fetched" />
        <Button variant="secondary" onClick={() => void stop()} disabled={busy || status.state === 'stopping'}>Stop</Button>
      </div>
    </div>
  );
}

/** Start another pass to retry missing prices or newly linked investments. */
export function PastPrices({ dates, unpublished = 0 }: { dates: PastDate[]; unpublished?: number }) {
  const { status, busy, start, stop } = usePriceJob();
  const active = status?.state === 'running' || status?.state === 'stopping';
  const unpublishedNote = unpublished > 0 && !active && <UnpublishedPrices count={unpublished} />;

  if (dates.length === 0 && !active) {
    return (
      <div className={styles.past}>
        <p className="muted">
          Nothing to fetch: scheduled prices are filled, or no investment has an ISIN yet.
        </p>
        {unpublishedNote}
      </div>
    );
  }
  return (
    <div className={styles.past}>
      <p className="muted" role="status">
        {active
          ? status?.state === 'stopping' ? 'Stopping after this download…' : `${status?.done ?? 0} of ${status?.total ?? 0} dates checked; ${status?.updated ?? 0} prices saved`
          : `${dates.length === 1 ? '1 date' : `${dates.length} dates`} to check, up to ${Math.max(0.1, size(dates)).toFixed(1)} MB`}
      </p>
      {!active && status?.message && <p className="muted">{status.message}</p>}
      <Button type="button" variant="secondary" disabled={busy || status?.state === 'stopping'}
        onClick={() => void (active ? stop() : start())}>
        {active ? 'Stop' : status ? 'Retry missing prices' : 'Fetch past prices'}
      </Button>
      {unpublishedNote}
    </div>
  );
}

/** Prices a source's settled file didn't include; checking again lets the next run look once more. */
function UnpublishedPrices({ count }: { count: number }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <p className="muted">
      {count === 1 ? '1 price was' : `${count} prices were`} not published by AMFI, NSE or BSE, so they are skipped.{' '}
      <button type="button" className="linkish" aria-disabled={pending} onClick={() => !pending && start(async () => {
        const r = await recheckMissingPrices();
        toast(r.ok ? 'Skipped prices will be checked again' : r.message);
        if (r.ok) router.refresh();
      })}>
        {pending ? 'Checking…' : 'Check them again'}
      </button>
    </p>
  );
}
