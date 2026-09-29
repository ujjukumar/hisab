'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import {
  Amount,
  DataTable,
  DateCell,
  NameCell,
  tableStyles,
  type Column,
} from '@/components/DataTable/DataTable';
import { Drawer, FieldPair } from '@/components/Drawer/Drawer';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { useToast } from '@/components/Toast/Toast';
import { deleteAccount, saveAccount, setAccountArchived } from '@/lib/actions/accounts';
import { today } from '@/lib/domain/dates';
import { formatAmount, formatDate } from '@/lib/domain/format';
import { paiseToInput } from '@/lib/domain/money';
import type { AccountRow } from '@/lib/queries/money';
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from '@/lib/validation/money';

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ row?: AccountRow; key: number } | null>(null);

  async function run(action: Promise<{ ok: boolean; message?: string }>, done: string) {
    const result = await action;
    toast(result.ok ? done : (result.message ?? 'Something went wrong. Try again.'));
  }

  const columns: Column<AccountRow>[] = [
    {
      key: 'name',
      header: 'Account',
      sub: 'Type',
      align: 'l',
      cell: (a) => (
        <NameCell
          name={
            <>
              {a.name}
              {a.archived && <span className={tableStyles.tag}>Archived</span>}
            </>
          }
          sub={ACCOUNT_TYPE_LABELS[a.type]}
        />
      ),
    },
    {
      key: 'opening',
      header: 'Opening balance',
      sub: 'As of',
      cell: (a) => (
        <Amount sub={formatDate(a.openingDate)}>{formatAmount(a.openingBalance)}</Amount>
      ),
    },
    {
      key: 'balance',
      header: 'Current balance',
      sub: 'Transactions',
      cell: (a) => <Amount sub={a.transactionCount}>{formatAmount(a.balance)}</Amount>,
    },
    {
      key: 'last',
      header: 'Last transaction',
      cell: (a) => <DateCell>{a.lastDate ? formatDate(a.lastDate) : '—'}</DateCell>,
    },
  ];

  const total = rows.filter((a) => !a.archived).reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      <DataTable
        title={`Accounts (${rows.length})`}
        actions={
          <Button variant="secondary" icon="plus" onClick={() => setEditing({ key: Date.now() })}>
            Add account
          </Button>
        }
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        empty={
          <>
            <p>
              Add the bank accounts, cards and cash you spend from. Their balances are worked out
              from your transactions.
            </p>
            <Button icon="plus" onClick={() => setEditing({ key: Date.now() })}>
              Add account
            </Button>
          </>
        }
        menu={(a) => (
          <Menu
            label={`Actions for ${a.name}`}
            items={[
              { label: 'Edit', onSelect: () => setEditing({ row: a, key: Date.now() }) },
              a.archived
                ? {
                    label: 'Unarchive',
                    onSelect: () => run(setAccountArchived(a.id, false), 'Account unarchived'),
                  }
                : {
                    label: 'Archive',
                    onSelect: () => run(setAccountArchived(a.id, true), 'Account archived'),
                  },
              ...(a.transactionCount === 0
                ? [
                    {
                      label: 'Delete',
                      danger: true,
                      onSelect: () => run(deleteAccount(a.id), 'Account deleted'),
                    },
                  ]
                : []),
            ]}
          />
        )}
        footer={
          <tr>
            <td className="l" colSpan={2}>
              Total of active accounts
            </td>
            <td className="r">
              <Amount>{formatAmount(total)}</Amount>
            </td>
            <td colSpan={2} />
          </tr>
        }
      />
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.row ? 'Edit account' : 'Add account'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="account-form">
              {editing?.row ? 'Save changes' : 'Save account'}
            </Button>
          </>
        }
      >
        {editing && (
          <AccountForm key={editing.key} row={editing.row} onDone={() => setEditing(null)} />
        )}
      </Drawer>
    </>
  );
}

function AccountForm({ row, onDone }: { row?: AccountRow; onDone: () => void }) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveAccount(row?.id ?? null, data);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      onDone();
      toast(row ? 'Changes saved' : 'Account saved');
    });
  }

  const describe = (field: string) =>
    errors[field] ? { 'aria-describedby': `e-${field}`, invalid: true } : {};
  const error = (field: string) =>
    errors[field] && <FieldError id={`e-${field}`}>{errors[field]}</FieldError>;

  return (
    <form
      id="account-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        autoFocus
        defaultValue={row?.name}
        {...describe('name')}
      />
      {error('name')}
      <SelectField
        label="Type"
        name="type"
        defaultValue={row?.type ?? 'bank'}
        {...describe('type')}
      >
        {ACCOUNT_TYPES.map((t) => (
          <option key={t} value={t}>
            {ACCOUNT_TYPE_LABELS[t]}
          </option>
        ))}
      </SelectField>
      {error('type')}
      <FieldPair>
        <TextField
          label="Opening balance (₹)"
          name="openingBalance"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          defaultValue={row ? paiseToInput(row.openingBalance) : ''}
          {...describe('openingBalance')}
        />
        <TextField
          label="Balance on"
          name="openingDate"
          type="date"
          defaultValue={row?.openingDate ?? today()}
          {...describe('openingDate')}
        />
      </FieldPair>
      {error('openingBalance')}
      {error('openingDate')}
      <p className="footnote">
        For a credit card, enter what you owe as a negative amount, for example −18,640.
      </p>
      <TextField
        label="Note (optional)"
        name="note"
        autoComplete="off"
        defaultValue={row?.note ?? ''}
        {...describe('note')}
      />
      {error('note')}
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}
