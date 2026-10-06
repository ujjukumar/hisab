import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { PriceJobProvider, PriceRefresher } from '@/components/Prices/Prices';
import { TopBar } from '@/components/TopBar/TopBar';
import type { Theme } from '@/components/ThemeToggle/ThemeToggle';
import { ToastProvider } from '@/components/Toast/Toast';
import { isSampleData } from '@/lib/queries/settings';
import { fontClassNames } from './fonts';
import '@/styles/tokens.css';
import '@/styles/globals.css';

// Every page reads the local database, so none may be prerendered at build time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Hisaab',
  description: 'A private record of money and investments.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [sampleData, cookieStore] = await Promise.all([isSampleData(), cookies()]);
  const savedTheme = cookieStore.get('hisaab-theme')?.value;
  const theme: Theme | null = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null;

  return (
    <html lang="en-IN" className={fontClassNames} data-theme={theme ?? undefined}>
      <body>
        <ToastProvider>
          <PriceJobProvider>
            <TopBar sampleData={sampleData} theme={theme} />
            <main>{children}</main>
            <PriceRefresher />
          </PriceJobProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
