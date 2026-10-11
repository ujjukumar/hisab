import type { ReactNode } from 'react';
import styles from './Tag.module.css';

/**
 * A small outlined label such as 'Ready', 'Off' or 'Imported automatically'.
 * It carries its meaning in words, so it never relies on colour alone.
 */
export function Tag({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'primary' | 'quiet';
  children: ReactNode;
}) {
  return <span className={`${styles.tag} ${styles[tone]}`}>{children}</span>;
}
