import { Funnel_Display, Funnel_Sans } from 'next/font/google';

/** Two faces: Funnel Display for titles and statement figures, Funnel Sans for everything else.
 *  Downloaded at build time and served locally. */

export const sans = Funnel_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const display = Funnel_Display({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500'],
  variable: '--font-display',
  display: 'swap',
});

export const fontClassNames = `${sans.variable} ${display.variable}`;
