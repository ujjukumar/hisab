import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon/Icon';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary';

type Props = {
  variant?: Variant;
  icon?: IconName;
  /** Hide the text label on narrow screens, as the mockup does for 'Add transaction'. */
  hideLabelOnMobile?: boolean;
  children?: ReactNode;
};

function classes(variant: Variant, hideLabel?: boolean) {
  return `${styles.btn} ${styles[variant]} ${hideLabel ? styles.hideLabel : ''}`;
}

export function Button({
  variant = 'primary',
  icon,
  hideLabelOnMobile,
  children,
  className = '',
  type = 'button',
  ...rest
}: Props & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`${classes(variant, hideLabelOnMobile)} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span className={styles.label}>{children}</span>}
    </button>
  );
}

/** The same look, but a real link. `download` makes it a plain file link, e.g. a CSV export. */
export function ButtonLink({
  href,
  variant = 'primary',
  icon,
  hideLabelOnMobile,
  download,
  onClick,
  children,
}: Props & { href: string; download?: boolean; onClick?: () => void }) {
  const content = (
    <>
      {icon && <Icon name={icon} />}
      {children && <span className={styles.label}>{children}</span>}
    </>
  );
  return download ? (
    <a href={href} download className={classes(variant, hideLabelOnMobile)}>
      {content}
    </a>
  ) : (
    <Link href={href} className={classes(variant, hideLabelOnMobile)} onClick={onClick}>
      {content}
    </Link>
  );
}

/** A square icon-only button. `label` is required: it becomes the accessible name. */
export function IconButton({
  icon,
  label,
  soft,
  className = '',
  type = 'button',
  ...rest
}: { icon: IconName; label: string; soft?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`${styles.icon} ${soft ? styles.soft : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** IconButton's look as a link, e.g. the month picker's arrows. `download` makes it a file link. */
export function IconLink({
  icon,
  label,
  href,
  download,
}: {
  icon: IconName;
  label: string;
  href: string;
  download?: boolean;
}) {
  if (download) {
    return (
      <a href={href} download aria-label={label} title={label} className={styles.icon}>
        <Icon name={icon} />
      </a>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className={styles.icon}>
      <Icon name={icon} />
    </Link>
  );
}
