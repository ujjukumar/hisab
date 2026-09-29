'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ChangeEvent, type ReactNode } from 'react';
import { Filters } from '@/components/DataTable/DataTable';
import { RangeField, SearchField, SelectField } from '@/components/Field/Field';
import type { AccountRow, CategoryOption } from '@/lib/queries/money';

const optionLabel = (item: { name: string; archived: boolean }) =>
  item.archived ? `${item.name} (archived)` : item.name;

/**
 * A filter bar whose state lives in the URL: selects apply at once, dates and search after
 * a short pause. Inputs are uncontrolled so typing never waits on the server. `values` names
 * every field; with `defaults`, a date range equal to them is left out of the URL.
 */
export function FilterForm({
  path,
  label,
  values,
  defaults,
  children,
}: {
  path: string;
  label: string;
  values: Record<string, string>;
  defaults?: { from: string; to: string };
  children: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // When the URL changes from elsewhere (Clear filters, back and forward), show its values,
  // but never overwrite the field the owner is typing in.
  const current = JSON.stringify(values);
  useEffect(() => {
    for (const [name, value] of Object.entries(JSON.parse(current) as Record<string, string>)) {
      const el = form.current?.elements.namedItem(name) as
        HTMLInputElement | HTMLSelectElement | null;
      if (el && el !== document.activeElement) el.value = value;
    }
  }, [current]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function apply() {
    clearTimeout(timer.current);
    if (!form.current) return;
    const data = new FormData(form.current);
    const next = new URLSearchParams();
    for (const key of Object.keys(values)) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    if (defaults) {
      const f = next.get('from');
      const t = next.get('to');
      if (!f || !t || (f === defaults.from && t === defaults.to)) {
        next.delete('from');
        next.delete('to');
      }
    }
    // Keep the sort; a new filter starts again from the first page.
    for (const key of ['sort', 'dir']) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  }

  function onChange(event: ChangeEvent<HTMLFormElement>) {
    if (event.target instanceof HTMLSelectElement) return apply();
    clearTimeout(timer.current);
    timer.current = setTimeout(apply, 300);
  }

  return (
    <form
      ref={form}
      onChange={onChange}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <Filters label={label}>{children}</Filters>
    </form>
  );
}

/** The Duration field, shared by both transaction lists. */
export function DurationField({ from, to }: { from: string; to: string }) {
  return (
    <RangeField
      label="Duration"
      from={{
        name: 'from',
        type: 'date',
        inputMode: undefined,
        defaultValue: from,
        'aria-label': 'From date',
      }}
      to={{
        name: 'to',
        type: 'date',
        inputMode: undefined,
        defaultValue: to,
        'aria-label': 'To date',
      }}
    />
  );
}

type Values = { from: string; to: string; type: string; cat: string; acct: string; q: string };

export function TransactionFilters({
  values,
  defaults,
  accounts,
  categories,
}: {
  values: Values;
  defaults: { from: string; to: string };
  accounts: Pick<AccountRow, 'id' | 'name' | 'archived'>[];
  categories: CategoryOption[];
}) {
  const { from, to, type, cat, acct, q } = values;
  return (
    <FilterForm path="/money" label="Filter transactions" values={values} defaults={defaults}>
      <DurationField from={from} to={to} />
      <SelectField label="Type" name="type" defaultValue={type}>
        <option value="">All types</option>
        <option value="income">Income</option>
        <option value="expense">Spending</option>
        <option value="transfer">Transfers</option>
      </SelectField>
      <SelectField label="Category" name="cat" defaultValue={cat}>
        <option value="">All categories</option>
        {(['expense', 'income'] as const).map((kind) => (
          <optgroup key={kind} label={kind === 'expense' ? 'Spending' : 'Income'}>
            {categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {optionLabel(c)}
                </option>
              ))}
          </optgroup>
        ))}
      </SelectField>
      <SelectField label="Account" name="acct" defaultValue={acct}>
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {optionLabel(a)}
          </option>
        ))}
      </SelectField>
      <SearchField
        label="Search"
        name="q"
        placeholder="Description or note"
        autoComplete="off"
        maxLength={100}
        defaultValue={q}
      />
    </FilterForm>
  );
}
