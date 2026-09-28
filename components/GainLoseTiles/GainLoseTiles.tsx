import Link from 'next/link';
import { formatINRSigned, formatPercent } from '@/lib/domain/format';
import styles from './GainLoseTiles.module.css';

export type Mover = {
  id: number;
  name: string;
  /** Gain in paise. Negative for a loss. */
  gain: number;
  /** Gain as a percentage of cost. */
  percent: number;
};

function List({ title, movers, lose }: { title: string; movers: Mover[]; lose?: boolean }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className={`${styles.list} ${lose ? styles.lose : ''}`}>
        {movers.length === 0 && <li className={styles.empty}>Nothing to show yet</li>}
        {movers.map((m) => (
          <li key={m.id}>
            <Link className={styles.name} href={`/investments/${m.id}`}>
              {m.name}
            </Link>
            <span className={`${styles.val} ${lose ? 'neg' : 'pos'}`}>
              {formatINRSigned(m.gain)} · {formatPercent(m.percent)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two tinted columns of best and worst performers. */
export function GainLoseTiles({ gainers, losers }: { gainers: Mover[]; losers: Mover[] }) {
  return (
    <div className={styles.gl}>
      <List title="Gaining most" movers={gainers} />
      <List title="Losing most" movers={losers} lose />
    </div>
  );
}
