'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

export type ToastAction = { label: string; onClick: () => void };
type Toast = (message: string, action?: ToastAction) => void;

const ToastContext = createContext<Toast>(() => {});

/** `const toast = useToast(); toast('Transaction saved')`, or with `{ label: 'Undo', onClick }`. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ message: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A toast with an action stays long enough to use it, and pauses while pointed at or focused.
  const start = useCallback((withAction: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCurrent(null), withAction ? 6000 : 3200);
  }, []);

  const toast = useCallback<Toast>(
    (message, action) => {
      setCurrent({ message, action });
      start(Boolean(action));
    },
    [start],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const pause = () => clearTimeout(timer.current);
  const resume = () => current && start(Boolean(current.action));

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className={`${styles.toast} ${current ? styles.show : ''}`}
        role="status"
        aria-live="polite"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
      >
        {current?.message}
        {current?.action && (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              current.action?.onClick();
              setCurrent(null);
            }}
          >
            {current.action.label}
          </button>
        )}
      </div>
    </ToastContext.Provider>
  );
}
