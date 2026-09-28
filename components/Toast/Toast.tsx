'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Toast.module.css';

const ToastContext = createContext<(message: string) => void>(() => {});

/** `const toast = useToast(); toast('Transaction saved')` */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((next: string) => {
    setMessage(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`${styles.toast} ${message ? styles.show : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
