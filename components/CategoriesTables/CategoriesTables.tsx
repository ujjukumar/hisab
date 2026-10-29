'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  NameCell,
  tableStyles,
  tableSortFromParams,
  tableSortHref,
  type Column,
} from '@/components/DataTable/DataTable';
import { Drawer } from '@/components/Drawer/Drawer';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { Segmented } from '@/components/Segmented/Segmented';
import { useToast } from '@/components/Toast/Toast';
import {
  deleteCategory,
  mergeCategory,
  saveCategory,
  setCategoryArchived,
} from '@/lib/actions/categories';
import { formatAmount } from '@/lib/domain/format';
import type { CategoryRow } from '@/lib/queries/money';
import { CATEGORY_COLORS } from '@/lib/validation/money';
import styles from './CategoriesTables.module.css';

type Kind = CategoryRow['kind'];

const COLOR_NAMES: Record<(typeof CATEGORY_COLORS)[number], string> = {
  c1: 'Blue',
  c2: 'Sage',
  c3: 'Brown',
  c4: 'Mauve',
  c5: 'Olive',
  c6: 'Slate',
  c7: 'Ochre',
  c8: 'Light blue',
};

const KINDS = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
] as const;

/** The Spending and Income category tables, sharing one add and edit drawer. */
export function CategoriesTables({ rows, yearLabel }: { rows: CategoryRow[]; yearLabel: string }) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<{ row?: CategoryRow; kind: Kind; key: number } | null>(
    null,
  );
  const [merging, setMerging] = useState<{ row: CategoryRow; key: number } | null>(null);

  async function run(action: Promise<{ ok: boolean; message?: string }>, done: string) {
    const result = await action;
    toast(result.ok ? done : (result.message ?? 'Something went wrong. Try again.'));
  }

  const table = (kind: Kind) => {
    const list = rows.filter((c) => c.kind === kind);
    const sortKey = kind === 'expense' ? 'spendingSort' : 'incomeSort';
    const sortDir = kind === 'expense' ? 'spendingDir' : 'incomeDir';
    const sort = tableSortFromParams(searchParams, ['name', 'count', 'total'], sortKey, sortDir);
    const noun = kind === 'expense' ? 'Spent' : 'Received';
    const columns: Column<CategoryRow>[] = [
      {
        key: 'name',
        header: 'Category',
        align: 'l',
        sortable: true,
        sortValue: (c) => c.name,
        cell: (c) => (
          <NameCell
            color={`var(--${c.color})`}
            name={
              <>
                {c.name}
                {c.archived && <span className={tableStyles.tag}>Archived</span>}
              </>
            }
          />
        ),
      },
      {
        key: 'count',
        header: 'Transactions',
        sub: yearLabel,
        sortable: true,
        sortValue: (c) => c.count,
        cell: (c) => <Amount>{c.count}</Amount>,
      },
      {
        key: 'total',
        header: noun,
        sub: yearLabel,
        sortable: true,
        sortValue: (c) => c.total,
        cell: (c) => <Amount>{formatAmount(c.total)}</Amount>,
      },
    ];
    const add = () => setEditing({ kind, key: Date.now() });

    return (
      <DataTable
        title={`${kind === 'expense' ? 'Spending' : 'Income'} (${list.length})`}
        actions={
          <Button variant="secondary" icon="plus" onClick={add}>
            {kind === 'expense' ? 'Add spending category' : 'Add income category'}
          </Button>
        }
        columns={columns}
        rows={list}
        rowKey={(c) => c.id}
        sort={sort}
        sortHref={(key, dir) => tableSortHref('/money/categories', searchParams.toString(), key, dir, sortKey, sortDir)}
        empty={
          <>
            <p>
              No {kind === 'expense' ? 'spending' : 'income'} categories yet. Add one to group your
              transactions.
            </p>
            <Button icon="plus" onClick={add}>
              Add category
            </Button>
          </>
        }
        menu={(c) => (
          <Menu
            label={`Actions for ${c.name}`}
            items={[
              {
                label: 'Edit',
                onSelect: () => setEditing({ row: c, kind: c.kind, key: Date.now() }),
              },
              c.archived
                ? {
                    label: 'Unarchive',
                    onSelect: () => run(setCategoryArchived(c.id, false), 'Category unarchived'),
                  }
                : {
                    label: 'Archive',
                    onSelect: () => run(setCategoryArchived(c.id, true), 'Category archived'),
                  },
              ...(rows.some((o) => o.kind === c.kind && o.id !== c.id)
                ? [
                    {
                      label: 'Merge into…',
                      onSelect: () => setMerging({ row: c, key: Date.now() }),
                    },
                  ]
                : []),
              ...(c.used
                ? []
                : [
                    {
                      label: 'Delete',
                      danger: true,
                      onSelect: () => run(deleteCategory(c.id), 'Category deleted'),
                    },
                  ]),
            ]}
          />
        )}
      />
    );
  };

  return (
    <>
      {table('expense')}
      {table('income')}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.row ? 'Edit category' : 'Add category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="category-form">
              {editing?.row ? 'Save changes' : 'Save category'}
            </Button>
          </>
        }
      >
        {editing && (
          <CategoryForm
            key={editing.key}
            row={editing.row}
            kind={editing.kind}
            onDone={() => setEditing(null)}
          />
        )}
      </Drawer>
      <Drawer
        open={merging !== null}
        onClose={() => setMerging(null)}
        title={merging ? `Merge ${merging.row.name}` : 'Merge category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMerging(null)}>
              Cancel
            </Button>
            <Button type="submit" form="merge-form">
              Merge
            </Button>
          </>
        }
      >
        {merging && (
          <MergeForm
            key={merging.key}
            row={merging.row}
            options={rows.filter((o) => o.kind === merging.row.kind && o.id !== merging.row.id)}
            onDone={() => setMerging(null)}
          />
        )}
      </Drawer>
    </>
  );
}

function MergeForm({
  row,
  options,
  onDone,
}: {
  row: CategoryRow;
  options: CategoryRow[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const active = options.filter((o) => !o.archived);
  const archived = options.filter((o) => o.archived);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const into = Number(new FormData(event.currentTarget).get('into'));
    const target = options.find((o) => o.id === into);
    startTransition(async () => {
      const result = await mergeCategory(row.id, into);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone();
      toast(`${row.name} merged into ${target?.name ?? 'the other category'}`);
    });
  }

  const option = (o: CategoryRow) => (
    <option key={o.id} value={o.id}>
      {o.name}
    </option>
  );

  return (
    <form
      id="merge-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <p className={styles.mergeNote}>
        Everything in {row.name} moves to the category you pick: its transactions, budgets and SMS
        rules. Then {row.name} is deleted. This can’t be undone.
      </p>
      <SelectField
        label="Merge into"
        name="into"
        autoFocus
        invalid={Boolean(error)}
        aria-describedby={error ? 'e-into' : undefined}
      >
        {active.map(option)}
        {archived.length > 0 && <optgroup label="Archived">{archived.map(option)}</optgroup>}
      </SelectField>
      {error && <FieldError id="e-into">{error}</FieldError>}
    </form>
  );
}

function CategoryForm({
  row,
  kind: initialKind,
  onDone,
}: {
  row?: CategoryRow;
  kind: Kind;
  onDone: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveCategory(row?.id ?? null, data);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      onDone();
      toast(row ? 'Changes saved' : 'Category saved');
    });
  }

  return (
    <form
      id="category-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      {row ? (
        // The kind is fixed once a category exists, so its transactions stay valid.
        <input type="hidden" name="kind" value={row.kind} />
      ) : (
        <Segmented
          items={[...KINDS]}
          value={kind}
          onChange={setKind}
          label="Category kind"
          name="kind"
        />
      )}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        autoFocus
        defaultValue={row?.name}
        invalid={Boolean(errors.name)}
        aria-describedby={errors.name ? 'e-name' : undefined}
      />
      {errors.name && <FieldError id="e-name">{errors.name}</FieldError>}
      <fieldset className={styles.colors} aria-describedby={errors.color ? 'e-color' : undefined}>
        <legend>Colour</legend>
        <div className={styles.swatches}>
          {CATEGORY_COLORS.map((c) => (
            <label key={c} className={styles.swatch} title={COLOR_NAMES[c]}>
              <input
                type="radio"
                name="color"
                value={c}
                aria-label={COLOR_NAMES[c]}
                defaultChecked={(row?.color ?? 'c1') === c}
              />
              <span style={{ background: `var(--${c})` }} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
      {errors.color && <FieldError id="e-color">{errors.color}</FieldError>}
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}
