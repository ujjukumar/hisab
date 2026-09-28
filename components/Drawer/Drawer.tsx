'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './Drawer.module.css';

/**
 * The side panel used for every add and edit form.
 * It is a native <dialog>, so the browser handles focus trapping, Escape and
 * making the rest of the page inert.
 */
export function Drawer({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.head}>
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.foot}>{footer}</div>}
    </dialog>
  );
}

/** Two fields side by side inside a drawer. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className={styles.two}>{children}</div>;
}

/** The running total shown at the bottom of the investment forms. */
export function FormTotal({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={styles.total}>
      <span>{label}</span>
      <span className={styles.num}>{value}</span>
    </div>
  );
}
