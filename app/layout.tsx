import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/components/TopBar/TopBar';
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
  const sampleData = await isSampleData();

  return (
    <html lang="en-IN" className={fontClassNames}>
      <body>
        <ToastProvider>
          <TopBar sampleData={sampleData} />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
