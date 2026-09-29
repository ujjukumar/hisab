import { formatINR } from '@/lib/domain/format';
import styles from './BudgetBar.module.css';

/** One budget line: name, spent of budget, and a bar that turns red when over. */
export function BudgetBar({
  name,
  spent,
  budget,
}: {
  name: string;
  /** Paise. */
  spent: number;
  /** Paise. */
  budget: number;
}) {
  const over = spent > budget;

  return (
    <div className={styles.budget}>
      <div className={styles.top}>
        <span className={styles.name}>{name}</span>
        <span className={`${styles.amt} ${over ? styles.over : ''}`}>
          <b>{formatINR(spent)}</b> of {formatINR(budget)}
        </span>
      </div>
      <Bar spent={spent} budget={budget} />
    </div>
  );
}

/** Just the bar. It is decorative, so callers must show the figures as text too. */
export function Bar({ spent, budget }: { spent: number; budget: number }) {
  const width = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className={`${styles.bar} ${spent > budget ? styles.over : ''}`} aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </div>
  );
}
