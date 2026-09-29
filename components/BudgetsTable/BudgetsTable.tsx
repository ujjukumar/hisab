'use client';

import Link from 'next/link';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { Bar } from '@/components/BudgetBar/BudgetBar';
import { Button } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  NameCell,
  tableStyles,
  type Column,
} from '@/components/DataTable/DataTable';
import { FieldError } from '@/components/Field/Field';
import { useToast } from '@/components/Toast/Toast';
import { copyLastMonthsBudgets, setBudget, undoCopyBudgets } from '@/lib/actions/budgets';
import { monthLabel } from '@/lib/domain/dates';
import { formatAmount } from '@/lib/domain/format';
import type { Paise } from '@/lib/domain/money';
import type { BudgetCategory, MonthBudgets } from '@/lib/queries/budgets';
import styles from './BudgetsTable.module.css';

type Row = MonthBudgets['rows'][number];

const percent = (spent: Paise, budget: Paise) => `${Math.round((spent / budget) * 100)}%`;

function name(c: BudgetCategory) {
  return (
    <NameCell
      color={`var(--${c.color})`}
      name={
        <>
          {c.name}
          {c.archived && <span className={tableStyles.tag}>Archived</span>}
        </>
      }
    />
  );
}

function Used({ spent, budget }: { spent: Paise; budget: Paise }) {
  return (
    <span className={styles.used}>
      <Bar spent={spent} budget={budget} />
      <Amount>{percent(spent, budget)}</Amount>
    </span>
  );
}

/** The month's budgets with inline editing, then the categories that have none. */
export function BudgetsTable({ data }: { data: MonthBudgets }) {
  const toast = useToast();
  const [copying, startCopy] = useTransition();
  const { month } = data;
  const label = monthLabel(month);

  function copy() {
    startCopy(async () => {
      const result = await copyLastMonthsBudgets(month);
      if (!result.ok) return toast(result.message);
      const token = result.undo;
      toast("Last month's budgets copied", {
        label: 'Undo',
        onClick: async () => {
          const undone = token ? await undoCopyBudgets(token) : null;
          toast(
            undone?.ok
              ? `${label} budgets restored`
              : (undone?.message ?? 'Too late to undo that.'),
          );
        },
      });
    });
  }

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Category', align: 'l', cell: name },
    {
      key: 'budget',
      header: 'Budget',
      cell: (r) => <BudgetInput key={r.budget} category={r} month={month} budget={r.budget} />,
    },
    { key: 'spent', header: 'Spent', cell: (r) => <Amount>{formatAmount(r.spent)}</Amount> },
    {
      key: 'left',
      header: 'Left',
      cell: (r) => (
        <Amount tone={r.over ? 'neg' : ''} sub={r.over ? 'Over budget' : undefined} subTone="neg">
          {formatAmount(r.left)}
        </Amount>
      ),
    },
    { key: 'used', header: 'Used', cell: (r) => <Used spent={r.spent} budget={r.budget} /> },
  ];

  const withoutColumns: Column<BudgetCategory>[] = [
    { key: 'name', header: 'Category', align: 'l', cell: name },
    {
      key: 'spent',
      header: 'Spent',
      sub: 'this month',
      cell: (c) => <Amount>{formatAmount(c.spent)}</Amount>,
    },
    { key: 'budget', header: 'Budget', cell: (c) => <SetBudget category={c} month={month} /> },
  ];

  return (
    <>
      <DataTable
        narrow
        title={`Budgets (${data.rows.length})`}
        actions={
          data.changedThisMonth &&
          data.lastMonthHasBudgets && (
            <Button variant="secondary" onClick={copy} disabled={copying}>
              Copy last month&rsquo;s budgets
            </Button>
          )
        }
        columns={columns}
        rows={data.rows}
        rowKey={(r) => r.id}
        empty={
          data.without.length > 0 ? (
            <p>No budgets for {label} yet. Set one for a category below to track its spending.</p>
          ) : (
            <p>
              No spending categories yet.{' '}
              <Link className="linkish" href="/money/categories">
                Add a category
              </Link>{' '}
              to set a budget for it.
            </p>
          )
        }
        footer={
          <tr>
            <td className="l">Total</td>
            <td className="r">
              <Amount>{formatAmount(data.budget)}</Amount>
            </td>
            <td className="r">
              <Amount>{formatAmount(data.spent)}</Amount>
            </td>
            <td className="r">
              <Amount
                tone={data.over ? 'neg' : ''}
                sub={data.over ? 'Over budget' : undefined}
                subTone="neg"
              >
                {formatAmount(data.left)}
              </Amount>
            </td>
            <td className="r">
              <Used spent={data.spent} budget={data.budget} />
            </td>
          </tr>
        }
      />
      {data.without.length > 0 && (
        <DataTable
          narrow
          title={`Without a budget (${data.without.length})`}
          columns={withoutColumns}
          rows={data.without}
          rowKey={(c) => c.id}
        />
      )}
    </>
  );
}

function SetBudget({ category, month }: { category: BudgetCategory; month: string }) {
  const [editing, setEditing] = useState(false);
  // Escape hands focus back to the button; tabbing away leaves it where it went.
  const [refocus, setRefocus] = useState(false);
  return editing ? (
    <BudgetInput
      category={category}
      month={month}
      budget={0}
      autoFocus
      onCancel={(escape) => {
        setRefocus(escape);
        setEditing(false);
      }}
    />
  ) : (
    <Button
      variant="secondary"
      className={styles.set}
      autoFocus={refocus}
      aria-label={`Set budget for ${category.name}`}
      onClick={() => setEditing(true)}
    >
      Set budget
    </Button>
  );
}

/** Saves on blur or Enter; Escape puts the old figure back. Empty or 0 removes the budget. */
function BudgetInput({
  category,
  month,
  budget,
  autoFocus,
  onCancel,
}: {
  category: BudgetCategory;
  month: string;
  budget: Paise;
  autoFocus?: boolean;
  /** Set when adding a budget: leaving it empty backs out instead of saving. */
  onCancel?: (escape: boolean) => void;
}) {
  const toast = useToast();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const initial = budget ? formatAmount(budget, budget % 100 ? 2 : 0) : '';
  const errorId = `budget-error-${category.id}`;

  function save(input: HTMLInputElement) {
    const amount = input.value.trim();
    if (amount === initial) return setError('');
    const removing = Number(amount) === 0; // '' counts as 0 too
    if (onCancel && removing) return onCancel(false);
    startTransition(async () => {
      const result = await setBudget({ categoryId: category.id, month, amount });
      if (!result.ok) return setError(result.fieldErrors.amount ?? result.message);
      setError('');
      toast(removing ? 'Budget removed' : 'Budget saved');
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.value = initial;
      setError('');
      onCancel?.(true);
    }
  }

  return (
    <span className={styles.edit}>
      <input
        className={styles.input}
        defaultValue={initial}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        readOnly={pending}
        aria-label={`Budget for ${category.name}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onBlur={(e) => save(e.currentTarget)}
        onKeyDown={onKeyDown}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </span>
  );
}
