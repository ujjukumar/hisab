import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

/** The three faces from the mockup. Downloaded at build time and served locally. */

export const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

// Variable font. The SOFT and WONK axes are set per element in the stylesheets.
export const serif = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-serif',
  display: 'swap',
});

export const fontClassNames = `${sans.variable} ${mono.variable} ${serif.variable}`;
