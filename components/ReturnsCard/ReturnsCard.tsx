import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { ChipLinks } from '@/components/Chips/Chips';
import { ReturnChart, type ReturnLine, type ValueSeries } from '@/components/charts/ReturnChart';
import { formatDate } from '@/lib/domain/format';
import { RETURN_RANGES, type ReturnRange } from '@/lib/domain/returns';
import type { IsoDate } from '@/lib/domain/dates';
import styles from './ReturnsCard.module.css';
import { BenchmarkFill } from './BenchmarkFill';
import { CompareBenchmarks } from './CompareBenchmarks';

export function ReturnsCard({ dates, lines, value, range, available, from, to, asOf, first, error, params, benchmarks, notices, missing = [] }: {
  dates: IsoDate[];
  lines: ReturnLine[];
  value?: ValueSeries;
  range: ReturnRange;
  available: typeof RETURN_RANGES[number][];
  from: IsoDate | null;
  to: IsoDate;
  asOf: IsoDate;
  first: IsoDate;
  error: string | null;
  params: Record<string, string | string[] | undefined>;
  benchmarks: { id: number; name: string }[];
  notices: string[];
  /** Benchmarks being compared whose NAV history still needs fetching. */
  missing?: { id: number; name: string }[];
}) {
  const retained = new URLSearchParams();
  for (const key of ['group', 'sold', 'period', 'sort', 'dir', 'compare']) {
    const value = params[key];
    if (typeof value === 'string') retained.set(key, value);
  }
  const href = (next: ReturnRange) => {
    const query = new URLSearchParams(retained);
    query.set('range', next);
    if (next === 'custom') {
      query.set('from', from ?? first);
      query.set('to', to);
    }
    return `/investments?${query}`;
  };
  return <Card title="Performance" sub="What your investments were worth on each day against what they cost. YTD starts on 1 January.">
    <ChipLinks label="Return range" items={available.map(([value, label]) => ({
      href: href(value), label, current: range === value,
    }))} />
    {range === 'custom' && <form action="/investments" className={styles.dates}>
      {[...retained.entries(), ['range', 'custom']].map(([key, value]) =>
        <input key={key} type="hidden" name={key} value={value} />)}
      <label>From <input type="date" name="from" defaultValue={typeof params.from === 'string' ? params.from : from ?? first} max={asOf} required /></label>
      <label>To <input type="date" name="to" defaultValue={typeof params.to === 'string' ? params.to : to} max={asOf} required /></label>
      <button type="submit">Show returns</button>
    </form>}
    {benchmarks.length ? <CompareBenchmarks items={benchmarks} /> :
      <p className={styles.note}>To compare with an index fund, <Link href="/settings">add a benchmark in Settings</Link>.</p>}
    <BenchmarkFill missing={missing}>
      {notices.map((message) => <p className={styles.note} key={message}>{message}</p>)}
    </BenchmarkFill>
    {error ? <p role="alert" className={styles.error}>{error}</p> : <>
      <ReturnChart dates={dates} lines={lines} value={value} />
      <p className={styles.note}>{formatDate(dates[0] ?? from ?? first)} to {formatDate(to)} · Comparisons use the same money added and taken out on the same dates.</p>
    </>}
  </Card>;
}