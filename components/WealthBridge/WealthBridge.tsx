import { formatINRSigned, formatShortINR, gainClass } from '@/lib/domain/format';
import type { Paise } from '@/lib/domain/money';
import styles from './WealthBridge.module.css';

/**
 * How net worth got from the start of a period to today: what markets did to the
 * investments, and what money came in or went out. Each step is a bar floating at
 * its place on one scale, so the two causes compare at a glance.
 */
export function WealthBridge({
  start,
  market,
  end,
  startLabel,
}: {
  start: Paise;
  /** Investment gain or loss over the period, after money added or taken out. */
  market: Paise;
  end: Paise;
  /** When the period starts, e.g. '20 Oct'. */
  startLabel: string;
}) {
  const money = end - start - market;
  const points = [start, start + market, end];
  const lo = Math.min(...points);
  const span = Math.max(...points) - lo;
  const at = (value: Paise) => (span ? ((value - lo) / span) * 100 : 0);
  const bar = (from: Paise, to: Paise) => ({
    left: `${at(Math.min(from, to))}%`,
    width: `${Math.max(Math.abs(at(to) - at(from)), span ? 0.5 : 0)}%`,
  });
  const steps = [
    {
      key: 'market',
      label: 'Market moves',
      value: market,
      from: start,
      tone: gainClass(market),
    },
    {
      key: 'money',
      label: 'Money in and out',
      value: money,
      from: start + market,
      tone: '',
    },
  ];

  return (
    <figure className={styles.bridge} aria-label="How net worth changed in this period">
      <figcaption className={styles.ends}>
        <span>
          {formatShortINR(start)} on {startLabel}
        </span>
        <span>{formatShortINR(end)} today</span>
      </figcaption>
      <ul className={styles.steps}>
        {steps.map((step) => (
          <li key={step.key}>
            <span className={styles.label}>{step.label}</span>
            <span className={styles.track} aria-hidden="true">
              <i
                className={`${styles.bar} ${step.key === 'money' ? styles.money : step.tone}`}
                style={bar(step.from, step.from + step.value)}
              />
            </span>
            <span className={`${styles.value} ${step.tone}`}>{formatINRSigned(step.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
