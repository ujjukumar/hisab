'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { fillBenchmarkHistory } from '@/lib/actions/benchmarks';
import styles from './ReturnsCard.module.css';

// Each benchmark is fetched once per visit, so a fund launched after the first investment
// doesn't keep asking for history it can't have.
const tried = new Set<number>();

/** Fetches NAV history for the benchmarks being compared, then shows the notices. */
export function BenchmarkFill({ missing, children }: {
  missing: { id: number; name: string }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const key = missing.map((item) => item.id).join(',');

  function fill(ids: number[]) {
    ids.forEach((id) => tried.add(id));
    start(async () => {
      setError(null);
      try {
        const result = await fillBenchmarkHistory(ids);
        if (!result.ok) setError(result.message);
      } catch {
        setError('Couldn’t get benchmark history. Check the internet connection and try again.');
      }
      router.refresh();
    });
  }

  useEffect(() => {
    const ids = key ? key.split(',').map(Number).filter((id) => !tried.has(id)) : [];
    if (ids.length) fill(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (pending) {
    return <p className={styles.note} role="status">
      Getting {missing.map((item) => item.name).join(', ')} history…
    </p>;
  }
  if (error) {
    return <p role="alert" className={styles.error}>
      {error}{' '}
      <button type="button" className="linkish" onClick={() => fill(missing.map((item) => item.id))}>Try again</button>
    </p>;
  }
  return children;
}
