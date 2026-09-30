'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/Button/Button';
import { useToast } from '@/components/Toast/Toast';
import { fetchPastPrices, refreshPrices, setAutoPrices } from '@/lib/actions/prices';
import { monthOf, shortMonthLabel, type IsoDate } from '@/lib/domain/dates';
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

// Measured in September 2026: one day of AMFI NAVs is about 0.3 MB compressed, NSE's about 0.2 MB.
const size = (dates: PastDate[]) =>
  dates.reduce((mb, d) => mb + (d.funds ? 0.3 : 0) + (d.listed ? 0.2 : 0), 0);

/** "Fetch past prices": one month-end at a time, with progress and a way to stop. */
export function PastPrices({ dates }: { dates: PastDate[] }) {
  const toast = useToast();
  const [progress, setProgress] = useState<{ month: string; at: number; total: number } | null>(
    null,
  );
  const stop = useRef(false);
  // When the last month is filled the button goes away, so focus moves to the message instead.
  const [ran, setRan] = useState(false);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (ran && dates.length === 0) doneRef.current?.focus();
  }, [ran, dates.length]);

  async function run() {
    const list = dates;
    stop.current = false;
    let saved = 0;
    let problem = '';
    for (const [i, d] of list.entries()) {
      if (stop.current) break;
      setProgress({ month: shortMonthLabel(monthOf(d.date)), at: i + 1, total: list.length });
      try {
        const r = await fetchPastPrices(d.date);
        if (r.ok) saved += r.updated;
        else problem = r.message;
      } catch {
        problem = "Past prices couldn't be saved. Try again.";
        break;
      }
    }
    setProgress(null);
    setRan(true);
    toast(problem || (saved > 0 ? 'Past prices fetched' : 'No past prices were found'));
  }

  if (dates.length === 0 && !progress) {
    return (
      <p className="muted" ref={doneRef} tabIndex={-1}>
        Nothing to fetch: every month-end already has a price, or no investment has an ISIN yet.
      </p>
    );
  }
  // One button that turns into Stop, so keyboard focus stays put.
  return (
    <div className={styles.past}>
      <p className="muted" role="status">
        {progress
          ? `Fetching ${progress.month} (${progress.at} of ${progress.total})`
          : `${dates.length === 1 ? '1 month' : `${dates.length} months`}, about ${Math.max(0.1, size(dates)).toFixed(1)} MB`}
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={progress ? () => (stop.current = true) : run}
      >
        {progress ? 'Stop' : 'Fetch past prices'}
      </Button>
    </div>
  );
}
