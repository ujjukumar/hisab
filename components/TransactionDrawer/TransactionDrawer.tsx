'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/Button/Button';
import { Drawer, FieldPair } from '@/components/Drawer/Drawer';
import { AmountField, FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { Segmented } from '@/components/Segmented/Segmented';
import { useToast } from '@/components/Toast/Toast';
import { deleteTransaction, saveTransaction, undoDelete } from '@/lib/actions/transactions';
import { currentMonth, endOfMonth, startOfMonth, today } from '@/lib/domain/dates';
import { paiseToInput } from '@/lib/domain/money';
import type { AccountRow, CategoryOption, TxnRow } from '@/lib/queries/money';

type Mode = 'add' | 'edit' | 'duplicate';
type Open = (mode: Mode, row?: TxnRow) => void;

const DrawerContext = createContext<Open>(() => {});

const TYPES = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
] as const;

type Type = (typeof TYPES)[number]['value'];
type Choice = Pick<AccountRow, 'id' | 'name' | 'archived'>;

/** Holds the one transaction drawer shared by the page-head button and every row menu. */
export function TransactionDrawerProvider({
  accounts,
  categories,
  children,
}: {
  accounts: Choice[];
  categories: CategoryOption[];
  children: ReactNode;
}) {
  const [state, setState] = useState<{ mode: Mode; row?: TxnRow; key: number } | null>(null);
  const open: Open = (mode, row) => setState({ mode, row, key: Date.now() });

  return (
    <DrawerContext.Provider value={open}>
      {children}
      <Drawer
        open={state !== null}
        onClose={() => setState(null)}
        title={state?.mode === 'edit' ? 'Edit transaction' : 'Add transaction'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setState(null)}>
              Cancel
            </Button>
            <Button type="submit" form="transaction-form">
              {state?.mode === 'edit' ? 'Save changes' : 'Save transaction'}
            </Button>
          </>
        }
      >
        {state && (
          <TransactionForm
            key={state.key}
            mode={state.mode}
            row={state.row}
            accounts={accounts}
            categories={categories}
            onDone={() => setState(null)}
          />
        )}
      </Drawer>
    </DrawerContext.Provider>
  );
}

export function AddTransactionButton() {
  const open = useContext(DrawerContext);
  return (
    <Button icon="plus" hideLabelOnMobile onClick={() => open('add')}>
      Add transaction
    </Button>
  );
}

/** Pick active choices, plus the one already on the row even if it has since been archived. */
function choices<T extends { id: number; archived: boolean }>(
  items: T[],
  keep: (number | null | undefined)[],
): T[] {
  return items.filter((item) => !item.archived || keep.includes(item.id));
}

function TransactionForm({
  mode,
  row,
  accounts,
  categories,
  onDone,
}: {
  mode: Mode;
  row?: TxnRow;
  accounts: Choice[];
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const toast = useToast();
  const pathname = usePathname();
  const params = useSearchParams();
  const [type, setType] = useState<Type>(row?.type ?? 'expense');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();

  const accountChoices = choices(accounts, [row?.accountId, row?.toAccountId]);
  const categoryChoices = choices(categories, [row?.categoryId]).filter((c) => c.kind === type);
  const defaultTo =
    row?.toAccountId ??
    accountChoices.find((a) => a.id !== (row?.accountId ?? accountChoices[0]?.id))?.id;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveTransaction(mode === 'edit' && row ? row.id : null, data);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      onDone();
      if (mode === 'edit') return toast('Changes saved');
      // On the Transactions tab, say so when the new row falls outside the dates on screen.
      const month = currentMonth();
      const from = params.get('from') ?? startOfMonth(month);
      const to = params.get('to') ?? endOfMonth(month);
      const date = String(data.get('date'));
      const hidden = pathname === '/money' && (date < from || date > to);
      toast(
        hidden ? "Transaction saved. It's outside the dates you're viewing." : 'Transaction saved',
      );
    });
  }

  const describe = (field: string, errorId: string) =>
    errors[field] ? { 'aria-describedby': errorId, invalid: true } : {};

  return (
    <form
      id="transaction-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <Segmented
        items={[...TYPES]}
        value={type}
        onChange={setType}
        label="Transaction type"
        name="type"
      />

      <AmountField
        label="Amount"
        name="amount"
        placeholder="0"
        autoFocus
        defaultValue={row ? paiseToInput(row.amount) : ''}
        {...describe('amount', 'e-amount')}
      />
      {errors.amount && <FieldError id="e-amount">{errors.amount}</FieldError>}

      <FieldPair>
        <TextField
          label="Date"
          name="date"
          type="date"
          defaultValue={mode === 'edit' && row ? row.date : today()}
          {...describe('date', 'e-date-cat')}
        />
        <div hidden={type === 'transfer'}>
          <SelectField
            label="Category"
            name="categoryId"
            defaultValue={row?.categoryId ?? undefined}
            {...describe('categoryId', 'e-date-cat')}
          >
            {categoryChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </div>
      </FieldPair>
      {(errors.date || errors.categoryId) && (
        <FieldError id="e-date-cat">{errors.date ?? errors.categoryId}</FieldError>
      )}

      <FieldPair>
        <SelectField
          label={type === 'transfer' ? 'From account' : 'Account'}
          name="accountId"
          defaultValue={row?.accountId ?? undefined}
          {...describe('accountId', 'e-accounts')}
        >
          {accountChoices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        <div hidden={type !== 'transfer'}>
          <SelectField
            label="To account"
            name="toAccountId"
            defaultValue={defaultTo}
            {...describe('toAccountId', 'e-accounts')}
          >
            {accountChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
        </div>
      </FieldPair>
      {(errors.accountId || errors.toAccountId) && (
        <FieldError id="e-accounts">{errors.accountId ?? errors.toAccountId}</FieldError>
      )}

      <TextField
        label="Description"
        name="description"
        autoComplete="off"
        placeholder="For example, weekly groceries"
        defaultValue={row?.description ?? ''}
        {...describe('description', 'e-description')}
      />
      {errors.description && <FieldError id="e-description">{errors.description}</FieldError>}

      <TextField
        label="Note (optional)"
        name="note"
        autoComplete="off"
        defaultValue={row?.note ?? ''}
        {...describe('note', 'e-note')}
      />
      {errors.note && <FieldError id="e-note">{errors.note}</FieldError>}

      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}

/** The ⋮ menu on a transaction row. Linked rows are changed from the investment side. */
export function TransactionRowMenu({ row }: { row: TxnRow }) {
  const open = useContext(DrawerContext);
  const toast = useToast();
  const router = useRouter();

  async function remove() {
    const result = await deleteTransaction(row.id);
    if (!result.ok) return toast(result.message);
    const token = result.undo;
    toast('Transaction deleted', {
      label: 'Undo',
      onClick: async () => {
        const undone = token ? await undoDelete(token) : null;
        toast(
          undone?.ok
            ? 'Transaction restored'
            : (undone?.message ?? 'Too late to undo that delete.'),
        );
      },
    });
  }

  const del = { label: 'Delete', onSelect: remove, danger: true };
  const items = row.investmentTxnId
    ? [
        {
          label: 'Open investment transaction',
          onSelect: () => router.push(`/investments/transactions?edit=${row.investmentTxnId}`),
        },
        del,
      ]
    : [
        { label: 'Edit', onSelect: () => open('edit', row) },
        { label: 'Duplicate', onSelect: () => open('duplicate', row) },
        del,
      ];

  return <Menu label={`Actions for ${row.description}`} items={items} />;
}
