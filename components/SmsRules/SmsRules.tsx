'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useOptimistic, useState, useTransition, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/Button/Button';
import {
  DataTable,
  DateCell,
  NameCell,
  tableSortFromParams,
  tableSortHref,
  type Column,
} from '@/components/DataTable/DataTable';
import { Drawer } from '@/components/Drawer/Drawer';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { Tag } from '@/components/Tag/Tag';
import { useToast } from '@/components/Toast/Toast';
import {
  deleteSmsRule,
  setSmsRuleEnabled,
  undoSmsRuleDelete,
  updateSmsRule,
} from '@/lib/actions/sms';
import styles from './SmsRules.module.css';

export type SmsRuleRow = {
  id: number;
  name: string;
  /** The sender the rule matches, e.g. 'AX-SMPBNK-S'. */
  sender: string;
  accountId: number;
  account: string;
  incomeCategoryId: number | null;
  /** Money in becomes a transfer from this account instead of income. */
  incomeTransferAccountId: number | null;
  /** 'Salary' or 'Transfer from Savings'; null when money in isn't imported. */
  income: string | null;
  expenseCategoryId: number | null;
  /** Money out becomes a transfer to this account instead of spending. */
  expenseTransferAccountId: number | null;
  expense: string | null;
  enabled: boolean;
  imported: number;
  /** When it last imported an SMS, already formatted, and the raw time for sorting. */
  lastUsed: string | null;
  lastUsedAt: string | null;
};

type Choice = { id: number; name: string; archived: boolean };
type CategoryChoice = Choice & { kind: 'income' | 'expense' };

const PATH = '/money/sms/rules';

/** Learned SMS rules: where each one sends its messages, how much it has done, and a switch. */
export function SmsRules({
  rows,
  accounts,
  categories,
}: {
  rows: SmsRuleRow[];
  accounts: Choice[];
  categories: CategoryChoice[];
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<{ row: SmsRuleRow; key: number } | null>(null);
  const [, startWork] = useTransition();
  const [shown, setShown] = useOptimistic(rows, (state, change: { id: number; enabled: boolean }) =>
    state.map((row) => (row.id === change.id ? { ...row, enabled: change.enabled } : row)),
  );
  const sort = tableSortFromParams(searchParams, ['name', 'sender', 'imported', 'lastUsed']);

  function setEnabled(row: SmsRuleRow, enabled: boolean) {
    startWork(async () => {
      setShown({ id: row.id, enabled });
      const result = await setSmsRuleEnabled(row.id, enabled);
      toast(result.message);
    });
  }

  function remove(row: SmsRuleRow) {
    startWork(async () => {
      const result = await deleteSmsRule(row.id);
      if (!result.ok || !result.undo) {
        toast(result.message);
        return;
      }
      const token = result.undo;
      toast(result.message, {
        label: 'Undo',
        onClick: async () => {
          const undone = await undoSmsRuleDelete(token);
          toast(undone.message);
        },
      });
    });
  }

  const columns: Column<SmsRuleRow>[] = [
    {
      key: 'name',
      header: 'Rule',
      align: 'l',
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <span className={r.enabled ? undefined : styles.off}>
          <NameCell name={r.name} />
          {!r.enabled && <Tag tone="quiet">Off</Tag>}
        </span>
      ),
    },
    {
      key: 'sender',
      header: 'Sender',
      align: 'l',
      sortable: true,
      sortValue: (r) => r.sender,
      cell: (r) => <span className={styles.sender}>{r.sender}</span>,
    },
    {
      key: 'account',
      header: 'Account',
      align: 'l',
      cell: (r) => r.account,
    },
    {
      key: 'income',
      header: 'Money in',
      align: 'l',
      cell: (r) => r.income ?? <span className="muted">Not imported</span>,
    },
    {
      key: 'expense',
      header: 'Money out',
      align: 'l',
      cell: (r) => r.expense ?? <span className="muted">Not imported</span>,
    },
    {
      key: 'imported',
      header: 'Imported',
      sortable: true,
      sortValue: (r) => r.imported,
      cell: (r) => r.imported,
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      align: 'l',
      sortable: true,
      sortValue: (r) => r.lastUsedAt,
      cell: (r) => <DateCell>{r.lastUsed ?? 'Not yet'}</DateCell>,
    },
    {
      key: 'on',
      header: 'On',
      cell: (r) => (
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          checked={r.enabled}
          aria-label={`Import SMS with ${r.name}`}
          onChange={(event) => setEnabled(r, event.target.checked)}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        title={`Rules (${rows.length})`}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        sort={sort}
        sortHref={(key, dir) => tableSortHref(PATH, searchParams.toString(), key, dir)}
        empty={
          <>
            <p>No rules yet. Approve an SMS with Import similar SMS automatically to add one.</p>
            <ButtonLink variant="secondary" href="/money/sms">
              Review SMS
            </ButtonLink>
          </>
        }
        menu={(r) => (
          <Menu
            label={`Actions for ${r.name}`}
            items={[
              { label: 'Edit rule', onSelect: () => setEditing({ row: r, key: Date.now() }) },
              {
                label: r.enabled ? 'Turn off' : 'Turn on',
                onSelect: () => setEnabled(r, !r.enabled),
              },
              {
                label: 'Show imported SMS',
                onSelect: () => router.push(`/money/sms/history?rule=${r.id}`),
              },
              { label: 'Delete rule', danger: true, onSelect: () => remove(r) },
            ]}
          />
        )}
      />
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit rule"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="sms-rule-form">
              Save rule
            </Button>
          </>
        }
      >
        {editing && (
          <RuleForm
            key={editing.key}
            row={editing.row}
            accounts={accounts}
            categories={categories}
            onDone={() => setEditing(null)}
          />
        )}
      </Drawer>
    </>
  );
}

function RuleForm({
  row,
  accounts,
  categories,
  onDone,
}: {
  row: SmsRuleRow;
  accounts: Choice[];
  categories: CategoryChoice[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();
  // Archived choices stay listed only when the rule already uses them.
  const accountChoices = accounts.filter((a) => !a.archived || a.id === row.accountId);
  const categoryChoices = (kind: 'income' | 'expense', current: number | null) =>
    categories.filter((c) => c.kind === kind && (!c.archived || c.id === current));
  const transferChoices = (current: number | null) =>
    accounts.filter((a) => !a.archived || a.id === current);
  const target = (categoryId: number | null, transferId: number | null) =>
    categoryId ? `category:${categoryId}` : transferId ? `transfer:${transferId}` : '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await updateSmsRule(data);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      onDone();
      toast(result.message);
    });
  }

  const describe = (field: string) =>
    errors[field] ? { 'aria-describedby': `e-${field}`, invalid: true } : {};
  const error = (field: string) =>
    errors[field] && <FieldError id={`e-${field}`}>{errors[field]}</FieldError>;

  return (
    <form
      id="sms-rule-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <input type="hidden" name="id" value={row.id} />
      <p className={styles.note}>
        Matches SMS from <span className={styles.sender}>{row.sender}</span> with the wording it
        learned. Change where those SMS go. A transfer moves money between your own accounts,
        like paying a card bill, and isn&apos;t counted as spending or income.
      </p>
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        autoFocus
        defaultValue={row.name}
        {...describe('name')}
      />
      {error('name')}
      <SelectField
        label="Account"
        name="accountId"
        defaultValue={String(row.accountId)}
        {...describe('accountId')}
      >
        {accountChoices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.archived ? ' (archived)' : ''}
          </option>
        ))}
      </SelectField>
      {error('accountId')}
      <SelectField
        label="Record money in as"
        name="incomeTarget"
        defaultValue={target(row.incomeCategoryId, row.incomeTransferAccountId)}
        {...describe('incomeTarget')}
      >
        <option value="">Don&apos;t import money in</option>
        <optgroup label="Income category">
          {categoryChoices('income', row.incomeCategoryId).map((c) => (
            <option key={c.id} value={`category:${c.id}`}>
              {c.name}
              {c.archived ? ' (archived)' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="Transfer between your accounts">
          {transferChoices(row.incomeTransferAccountId).map((a) => (
            <option key={a.id} value={`transfer:${a.id}`}>
              Transfer from {a.name}
              {a.archived ? ' (archived)' : ''}
            </option>
          ))}
        </optgroup>
      </SelectField>
      {error('incomeTarget')}
      <SelectField
        label="Record money out as"
        name="expenseTarget"
        defaultValue={target(row.expenseCategoryId, row.expenseTransferAccountId)}
        {...describe('expenseTarget')}
      >
        <option value="">Don&apos;t import money out</option>
        <optgroup label="Spending category">
          {categoryChoices('expense', row.expenseCategoryId).map((c) => (
            <option key={c.id} value={`category:${c.id}`}>
              {c.name}
              {c.archived ? ' (archived)' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="Transfer between your accounts">
          {transferChoices(row.expenseTransferAccountId).map((a) => (
            <option key={a.id} value={`transfer:${a.id}`}>
              Transfer to {a.name}
              {a.archived ? ' (archived)' : ''}
            </option>
          ))}
        </optgroup>
      </SelectField>
      {error('expenseTarget')}
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}
