'use client';

import { useState, type ReactNode } from 'react';
import { Card } from '@/components/Card/Card';
import { Chips } from '@/components/Chips/Chips';
import { SelectField } from '@/components/Field/Field';
import styles from './SwitchCard.module.css';

export type SwitchOption = { value: string; label: string; content: ReactNode };

/**
 * A card that shows one of several views, picked with chips or a select. Every view is
 * rendered on the server; switching only changes which one is shown.
 */
export function SwitchCard({
  id,
  label,
  options,
  variant = 'chips',
  title,
  sub,
  span,
  footer,
  className,
}: {
  /** Unique on the page; names the select. */
  id: string;
  /** What the choice is, e.g. 'Time range'. */
  label: string;
  options: SwitchOption[];
  variant?: 'chips' | 'select';
  title: ReactNode;
  sub?: ReactNode;
  span?: 4 | 5 | 7 | 8 | 12;
  footer?: ReactNode;
  className?: string;
}) {
  const [value, setValue] = useState(options[0]?.value ?? '');
  const shown = options.find((o) => o.value === value) ?? options[0];

  return (
    <Card title={title} sub={sub} span={span} footer={footer} className={className}>
      {variant === 'chips' ? (
        <Chips items={options} value={value} onChange={setValue} label={label} />
      ) : (
        <SelectField
          id={id}
          label={label}
          className={styles.select}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      )}
      {shown?.content}
    </Card>
  );
}
