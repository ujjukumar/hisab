'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './ThemeToggle.module.css';

export type Theme = 'light' | 'dark';

export function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const [theme, setTheme] = useState(initialTheme);

  function toggle() {
    const current = theme ?? (
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    );
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `hisaab-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      title={theme === 'dark' ? 'Switch to light theme' : theme === 'light' ? 'Switch to dark theme' : 'Toggle light and dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}