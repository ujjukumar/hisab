import type { JSX, SVGProps } from 'react';

/** The icon set from the mockup. Hand-drawn paths; nothing here comes from a third party. */

export type IconName =
  | 'plus'
  | 'chevDown'
  | 'chevRight'
  | 'kebab'
  | 'search'
  | 'refresh'
  | 'download'
  | 'close'
  | 'user'
  | 'sort';

const stroke = (size: number, width: number, join = false) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  ...(join ? { strokeLinejoin: 'round' as const } : {}),
});

const ICONS: Record<IconName, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  plus: (p) => (
    <svg {...stroke(16, 2.4)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  chevDown: (p) => (
    <svg {...stroke(20, 2.6, true)} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  chevRight: (p) => (
    <svg {...stroke(13, 3.2, true)} {...p}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  kebab: (p) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" {...p}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  ),
  search: (p) => (
    <svg {...stroke(17, 2)} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  refresh: (p) => (
    <svg {...stroke(18, 2, true)} {...p}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  ),
  download: (p) => (
    <svg {...stroke(17, 2, true)} {...p}>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  ),
  close: (p) => (
    <svg {...stroke(20, 2)} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  user: (p) => (
    <svg {...stroke(18, 2)} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  sort: (p) => (
    <svg width={8} height={13} viewBox="0 0 8 13" {...p}>
      <path className="up" d="M4 0 8 5H0z" />
      <path className="dn" d="M4 13 0 8h8z" />
    </svg>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return ICONS[name]({ 'aria-hidden': true, focusable: false, ...props });
}
