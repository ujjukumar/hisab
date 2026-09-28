import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './Field.module.css';

/** The bordered box with a small notched label, as in the mockup. */
function Shell({
  id,
  label,
  className = '',
  invalid,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.field} ${className}`} data-invalid={invalid ? 'true' : undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

type Base = { id?: string; label: string; invalid?: boolean; className?: string };

export function TextField({
  id,
  label,
  invalid,
  className,
  name,
  ...rest
}: Base & InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = id ?? `f-${name}`;
  return (
    <Shell id={fieldId} label={label} invalid={invalid} className={className}>
      <input id={fieldId} name={name} aria-invalid={invalid || undefined} {...rest} />
    </Shell>
  );
}

export function SelectField({
  id,
  label,
  invalid,
  className = '',
  name,
  children,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = id ?? `f-${name}`;
  return (
    <Shell id={fieldId} label={label} invalid={invalid} className={`${styles.select} ${className}`}>
      <select id={fieldId} name={name} aria-invalid={invalid || undefined} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

export function SearchField({
  id,
  label,
  className = '',
  name,
  ...rest
}: Base & InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = id ?? `f-${name}`;
  return (
    <Shell id={fieldId} label={label} className={`${styles.search} ${className}`}>
      <Icon name="search" />
      <input id={fieldId} name={name} type="search" {...rest} />
    </Shell>
  );
}

/** Two inputs sharing one box, used for 'amount from / to' filters. */
export function RangeField({
  id,
  label,
  className = '',
  from,
  to,
}: Base & {
  from: InputHTMLAttributes<HTMLInputElement> & { name: string };
  to: InputHTMLAttributes<HTMLInputElement> & { name: string };
}) {
  const fieldId = id ?? `f-${from.name}`;
  return (
    <Shell id={fieldId} label={label} className={`${styles.range} ${className}`}>
      <input id={fieldId} inputMode="decimal" {...from} />
      <span className={styles.sep} aria-hidden="true">
        to
      </span>
      <input inputMode="decimal" aria-label={`${label}, to`} {...to} />
    </Shell>
  );
}

/** The large ₹ amount input at the top of a drawer form. */
export function AmountField({
  id,
  label,
  invalid,
  className = '',
  name,
  ...rest
}: Base & InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = id ?? `f-${name}`;
  return (
    <Shell id={fieldId} label={label} invalid={invalid} className={`${styles.amount} ${className}`}>
      <span className={styles.currency} aria-hidden="true">
        ₹
      </span>
      <input
        id={fieldId}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </Shell>
  );
}

/** Inline validation message. Always rendered so the layout does not jump. */
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  return (
    <p className={styles.error} id={id} role={children ? 'alert' : undefined}>
      {children}
    </p>
  );
}
