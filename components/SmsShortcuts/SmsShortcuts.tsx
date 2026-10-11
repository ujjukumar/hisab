'use client';

import { useSyncExternalStore } from 'react';
import { Drawer } from '@/components/Drawer/Drawer';
import styles from './SmsShortcuts.module.css';

const STORAGE_KEY = 'hisaab:sms-shortcuts';
const CHANGE_EVENT = 'hisaab:sms-shortcuts';

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function enabledNow(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Whether the review shortcuts are on. The choice is kept in this browser only. */
export function useSmsShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, enabledNow, () => true);
}

function setEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    // Private windows may refuse storage; the switch then lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const KEYS: { keys: string[]; action: string }[] = [
  { keys: ['J', 'K'], action: 'Next or previous SMS' },
  { keys: ['↓', '↑'], action: 'Move through the list when it has focus' },
  { keys: ['X'], action: 'Select or clear the open SMS' },
  { keys: ['A'], action: 'Approve the open SMS' },
  { keys: ['L'], action: 'Turn “Import similar SMS automatically” on or off' },
  { keys: ['R'], action: 'Reject the open SMS' },
  { keys: ['S'], action: 'Skip to the next SMS' },
  { keys: ['Shift', 'A'], action: 'Approve the selected SMS that are ready' },
  { keys: ['Shift', 'R'], action: 'Reject the selected SMS' },
  { keys: ['Esc'], action: 'Clear the selection' },
  { keys: ['?'], action: 'Show this list' },
];

/** The list of review shortcuts, with the switch that turns them off. */
export function SmsShortcutsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const enabled = useSmsShortcutsEnabled();
  return (
    <Drawer open={open} onClose={onClose} title="Keyboard shortcuts">
      <label className={styles.toggle}>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Use keyboard shortcuts on this page
      </label>
      <p className={styles.note}>
        Shortcuts never fire while you type in a field. Keys that change something do the same as
        the button they belong to.
      </p>
      <dl className={styles.list} aria-disabled={!enabled}>
        {KEYS.map((row) => (
          <div key={row.action} className={styles.row}>
            <dt>
              {row.keys.map((key, i) => (
                <span key={key}>
                  {i > 0 && (row.keys[0] === 'Shift' ? ' + ' : ' / ')}
                  <kbd>{key}</kbd>
                </span>
              ))}
            </dt>
            <dd>{row.action}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}
