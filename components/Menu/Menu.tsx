'use client';

import { useId, useRef, useState } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './Menu.module.css';

export type MenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
};

/**
 * The kebab menu on table rows. It uses the popover API, so clicking away or
 * pressing Escape closes it without any listener of our own.
 */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // The popover lives in the top layer, so it is positioned against the viewport.
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    return rect ? { top: rect.bottom + 6, left: Math.max(8, rect.right - 200) } : undefined;
  };
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        popoverTarget={id}
        onClick={() => setPos(place())}
      >
        <Icon name="kebab" />
      </button>
      <div
        id={id}
        popover="auto"
        className={styles.menu}
        style={pos}
        onToggle={(event) => setOpen(event.newState === 'open')}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.danger ? styles.danger : undefined}
            onClick={() => {
              document.getElementById(id)?.hidePopover();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
