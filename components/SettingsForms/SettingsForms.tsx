'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { useToast } from '@/components/Toast/Toast';
import { restoreBackup, savePreferences, startFresh } from '@/lib/actions/settings';
import { addBenchmark, removeBenchmark } from '@/lib/actions/benchmarks';
import { COMPOUNDING, COMPOUNDING_LABELS } from '@/lib/domain/assets';
import type { SuggestedBenchmark } from '@/lib/domain/benchmarks';
import { MONTH_NAMES } from '@/lib/domain/dates';
import type { ActionResult } from '@/lib/validation/money';
import styles from './SettingsForms.module.css';

/** One setting: what it does on the left, its control on the right (stacked on phones). */
export function SettingRow({
  title,
  children,
  control,
}: {
  title: string;
  children: ReactNode;
  control: ReactNode;
}) {
  return (
    <section className={styles.row}>
      <div className={styles.text}>
        <h3 className={styles.title}>{title}</h3>
        {children}
      </div>
      <div className={styles.control}>{control}</div>
    </section>
  );
}

/** Submit a form to an action; show field errors in place, or toast `done` (and clear the form). */
export function useActionForm(
  action: (data: FormData) => Promise<ActionResult>,
  done: string,
  { reset = true } = {},
) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await action(data);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      setErrors({});
      setFormError('');
      if (reset) form.reset();
      toast(done);
    });
  }

  const describe = (field: string) =>
    errors[field] ? { 'aria-describedby': `e-${field}`, invalid: true } : {};
  const error = (field: string) =>
    errors[field] && <FieldError id={`e-${field}`}>{errors[field]}</FieldError>;
  const summary = formError && <FieldError>{formError}</FieldError>;
  return { submit, pending, describe, error, summary };
}

export function RestoreForm() {
  const f = useActionForm(restoreBackup, 'Backup restored');
  return (
    <form className={styles.form} onSubmit={f.submit} noValidate aria-busy={f.pending}>
      <TextField
        label="Backup file (.db)"
        name="file"
        type="file"
        accept=".db,application/vnd.sqlite3,application/x-sqlite3"
        {...f.describe('file')}
      />
      {f.error('file')}
      {f.summary}
      <Button type="submit" variant="secondary" disabled={f.pending}>
        {f.pending ? 'Restoring…' : 'Restore backup'}
      </Button>
    </form>
  );
}

export function StartFreshForm({ sample }: { sample: boolean }) {
  const f = useActionForm(
    (data) => startFresh({ confirm: String(data.get('confirm') ?? '') }),
    sample ? 'Sample data removed' : 'All data deleted',
  );
  return (
    <form className={styles.form} onSubmit={f.submit} noValidate aria-busy={f.pending}>
      <TextField
        label="Type DELETE to confirm"
        name="confirm"
        autoComplete="off"
        spellCheck={false}
        {...f.describe('confirm')}
      />
      {f.error('confirm')}
      {f.summary}
      <Button type="submit" variant="secondary" disabled={f.pending}>
        {sample ? 'Remove sample data and start fresh' : 'Delete all data and start fresh'}
      </Button>
    </form>
  );
}

export function PreferencesForm({
  startMonth,
  compounding,
}: {
  startMonth: number;
  compounding: (typeof COMPOUNDING)[number];
}) {
  const f = useActionForm(savePreferences, 'Preferences saved', { reset: false });
  return (
    <form className={styles.form} onSubmit={f.submit} noValidate aria-busy={f.pending}>
      <SelectField
        label="Financial year starts in"
        name="financialYearStartMonth"
        defaultValue={String(startMonth)}
        {...f.describe('financialYearStartMonth')}
      >
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </SelectField>
      {f.error('financialYearStartMonth')}
      <SelectField
        label="New fixed deposits compound"
        name="defaultCompounding"
        defaultValue={compounding}
        {...f.describe('defaultCompounding')}
      >
        {COMPOUNDING.map((c) => (
          <option key={c} value={c}>
            {COMPOUNDING_LABELS[c]}
          </option>
        ))}
      </SelectField>
      {f.error('defaultCompounding')}
      {f.summary}
      <Button type="submit" disabled={f.pending}>
        Save preferences
      </Button>
    </form>
  );
}

export function BenchmarkForm() {
  const form = useActionForm(addBenchmark, 'Benchmark added');
  return <form className={styles.form} onSubmit={form.submit} noValidate aria-busy={form.pending}>
    <TextField label="Name" name="name" placeholder="Index fund" {...form.describe('name')} />
    {form.error('name')}
    <TextField label="Fund ISIN" name="isin" placeholder="INF…" autoComplete="off"
      {...form.describe('isin')} />
    {form.error('isin')}
    {form.summary}
    <Button type="submit" disabled={form.pending}>Add benchmark</Button>
  </form>;
}

export function SuggestedBenchmarks({ items }: { items: readonly SuggestedBenchmark[] }) {
  return <ul className={styles.suggestions}>
    {items.map((item) => <SuggestedBenchmarkItem key={item.isin} {...item} />)}
  </ul>;
}

function SuggestedBenchmarkItem({ name, fund, isin }: SuggestedBenchmark) {
  const form = useActionForm(addBenchmark, 'Benchmark added');
  return <li>
    <form className={styles.suggestion} onSubmit={form.submit} aria-busy={form.pending}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="isin" value={isin} />
      <span className={styles.suggestionText}>
        <strong>{name}</strong>
        <span>{fund}</span>
      </span>
      <Button type="submit" variant="secondary" disabled={form.pending}>
        Add<span className="sr-only"> {name}</span>
      </Button>
      {form.summary}
    </form>
  </li>;
}

export function RemoveBenchmark({ id }: { id: number }) {
  const form = useActionForm(removeBenchmark, 'Benchmark removed');
  return <form onSubmit={form.submit} aria-busy={form.pending}>
    <input type="hidden" name="id" value={id} />
    {form.summary}
    <Button type="submit" variant="secondary" disabled={form.pending}>Remove</Button>
  </form>;
}
