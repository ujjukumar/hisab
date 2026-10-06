'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button, IconButton } from '@/components/Button/Button';
import { Drawer, FieldPair, FormTotal } from '@/components/Drawer/Drawer';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { Segmented } from '@/components/Segmented/Segmented';
import { useToast } from '@/components/Toast/Toast';
import {
  deleteInvestmentTxn,
  saveAsset,
  saveInvestmentTxn,
  saveUpdates,
  setAssetArchived,
  undoInvestmentDelete,
} from '@/lib/actions/investments';
import { fetchInvestmentPrices } from '@/lib/actions/prices';
import type { AssetType, InvestmentAction } from '@/lib/db/schema';
import {
  ACTION_LABELS,
  actionsFor,
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  ASSET_TYPE_LABELS,
  ASSET_TYPES,
  COMPOUNDING,
  COMPOUNDING_LABELS,
  defaultAssetClass,
  defaultValuation,
  GROUPS,
} from '@/lib/domain/assets';
import { today } from '@/lib/domain/dates';
import { formatAmount, formatDate } from '@/lib/domain/format';
import { moneyMoved, unitsAmount } from '@/lib/domain/holdings';
import { paiseToInput, parsePaise } from '@/lib/domain/money';
import type { AccountRow } from '@/lib/queries/money';
import type { AssetOption, InvTxnRow } from '@/lib/queries/investments';
import { parseDecimal } from '@/lib/validation/investments';
import styles from './InvestmentDrawer.module.css';

type State =
  | { kind: 'txn'; row?: InvTxnRow; assetId?: number }
  | { kind: 'asset'; id: number }
  | { kind: 'updates'; ids: number[] };

type Compounding = (typeof COMPOUNDING)[number];

type Choice = Pick<AccountRow, 'id' | 'name' | 'archived'>;

const Context = createContext<{
  open: (state: State) => void;
  options: AssetOption[];
  compounding: Compounding;
}>({
  open: () => {},
  options: [],
  compounding: 'quarterly',
});

const FORM = 'investment-form';

/** Holds the one investment drawer: transactions, investment details, and price updates. */
export function InvestmentDrawerProvider({
  options,
  accounts,
  compounding,
  children,
}: {
  options: AssetOption[];
  accounts: Choice[];
  /** The Settings default for new fixed deposits. */
  compounding: Compounding;
  children: ReactNode;
}) {
  const [state, setState] = useState<(State & { key: number }) | null>(null);
  const open = (next: State) => setState({ ...next, key: Date.now() });
  const close = () => setState(null);

  const asset = state?.kind === 'asset' ? options.find((o) => o.id === state.id) : undefined;
  const updating = state?.kind === 'updates' ? options.filter((o) => state.ids.includes(o.id)) : [];
  const words = updateWords(updating);

  const [title, save] =
    state?.kind === 'asset'
      ? ['Edit investment', 'Save changes']
      : state?.kind === 'updates'
        ? [words.title, words.save]
        : state?.row
          ? ['Edit investment transaction', 'Save changes']
          : ['Add investment transaction', 'Save transaction'];

  return (
    <Context.Provider value={{ open, options, compounding }}>
      {children}
      <Drawer
        open={state !== null}
        onClose={close}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={FORM}>
              {save}
            </Button>
          </>
        }
      >
        {state?.kind === 'txn' && (
          <TxnForm
            key={state.key}
            row={state.row}
            assetId={state.assetId}
            options={options}
            accounts={accounts}
            onDone={close}
          />
        )}
        {state?.kind === 'asset' && asset && (
          <AssetForm key={state.key} asset={asset} onDone={close} />
        )}
        {state?.kind === 'updates' && (
          <UpdatesForm key={state.key} assets={updating} done={words.done} onDone={close} />
        )}
      </Drawer>
    </Context.Provider>
  );
}

/* ---------- shared form plumbing ---------- */

type Result = Awaited<ReturnType<typeof saveInvestmentTxn>>;

/** Submit, show field errors and focus the first one, or close and toast. */
function useSubmit(action: (data: FormData) => Promise<Result>, onDone: () => void) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>, done: string) {
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
      onDone();
      toast(done);
    });
  }

  const describe = (field: string) =>
    errors[field] ? { 'aria-describedby': `e-${field}`, invalid: true } : {};
  const error = (field: string) =>
    errors[field] && <FieldError id={`e-${field}`}>{errors[field]}</FieldError>;
  return { submit, pending, describe, error, formError };
}

type Plumbing = Pick<ReturnType<typeof useSubmit>, 'describe' | 'error'>;

/* ---------- investment transaction ---------- */

const PAID: InvestmentAction[] = ['buy', 'deposit', 'fee'];

const TOTAL_LABELS: Record<InvestmentAction, string> = {
  buy: 'You pay',
  sell: 'You receive',
  split: '',
  deposit: 'You pay',
  withdrawal: 'You receive',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
};

const AMOUNT_LABELS: Partial<Record<InvestmentAction, string>> = {
  deposit: 'Amount paid in',
  withdrawal: 'Amount taken out',
  dividend: 'Amount received',
  interest: 'Amount received',
  fee: 'Fee amount',
};

type Figures = { units: string; price: string; fees: string; amount: string };

/** The running total, worked out the same way the server will. Null while a figure is unreadable. */
function liveTotal(action: InvestmentAction, f: Figures): number | null {
  if (action === 'split') return null;
  const trade = action === 'buy' || action === 'sell';
  const fees = trade && f.fees.trim() ? parsePaise(f.fees) : { ok: true as const, value: 0 };
  if (!fees.ok) return null;
  let amount: number;
  if (trade) {
    const units = parseDecimal(f.units, 6);
    const price = parseDecimal(f.price, 6);
    if (!units || !price) return null;
    amount = unitsAmount(units, price);
  } else {
    const parsed = parsePaise(f.amount);
    if (!parsed.ok) return null;
    amount = parsed.value;
  }
  return moneyMoved({ action, amount, fees: fees.value });
}

function TxnForm({
  row,
  assetId: startAsset,
  options,
  accounts,
  onDone,
}: {
  row?: InvTxnRow;
  assetId?: number;
  options: AssetOption[];
  accounts: Choice[];
  onDone: () => void;
}) {
  const firstActive = options.find((o) => !o.archived && !o.sold)?.id;
  const [assetId, setAssetId] = useState<string>(
    String(row?.assetId ?? startAsset ?? firstActive ?? 'new'),
  );
  const [type, setType] = useState<AssetType>('mutual_fund');
  const asset = options.find((o) => String(o.id) === assetId);
  const valuation = asset?.valuation ?? defaultValuation(type);
  const actions = actionsFor(valuation);
  const [picked, setPicked] = useState<InvestmentAction>(row?.action ?? actions[0] ?? 'buy');
  const action = actions.includes(picked) ? picked : (actions[0] ?? 'buy');

  const [figures, setFigures] = useState<Figures>({
    units: row?.units ?? '',
    price: row?.price ?? (asset?.valuation === 'units' ? (asset.lastPrice ?? '') : ''),
    fees: row?.fees ? paiseToInput(row.fees) : '',
    amount: row?.amount && !row.units ? paiseToInput(row.amount) : '',
  });
  const figure = (name: keyof Figures) => ({
    name,
    value: figures[name],
    onChange: (e: { target: { value: string } }) =>
      setFigures((f) => ({ ...f, [name]: e.target.value })),
    inputMode: 'decimal' as const,
    autoComplete: 'off',
  });

  function pickAsset(value: string) {
    setAssetId(value);
    const next = options.find((o) => String(o.id) === value);
    // Prefill the latest price, never another asset's; the owner can still type over it.
    const price = next?.valuation === 'units' ? (next.lastPrice ?? '') : '';
    setFigures((f) => ({ ...f, price }));
  }

  const { submit, pending, describe, error, formError } = useSubmit(
    (data) => saveInvestmentTxn(row?.id ?? null, data),
    onDone,
  );

  const total = liveTotal(action, figures);
  const trade = action === 'buy' || action === 'sell';
  const shares = asset && GROUPS.find((g) => g.key === asset.group)?.unitWord === 'shares';
  const accountChoices = accounts.filter((a) => !a.archived || a.id === row?.accountId);

  return (
    <form
      id={FORM}
      onSubmit={(e) => submit(e, row ? 'Changes saved' : 'Transaction saved')}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <Segmented
        items={actions.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
        value={action}
        onChange={setPicked}
        label="Action"
        name="action"
      />
      {error('action')}

      <SelectField
        label="Investment"
        name="assetId"
        value={assetId}
        onChange={(e) => pickAsset(e.target.value)}
        autoFocus
        {...describe('assetId')}
      >
        {GROUPS.map((g) => {
          const items = options.filter(
            (o) => o.group === g.key && (!o.archived || o.id === row?.assetId),
          );
          return (
            items.length > 0 && (
              <optgroup key={g.key} label={g.title}>
                {items.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            )
          );
        })}
        <option value="new">New investment…</option>
      </SelectField>
      {error('assetId')}

      {assetId === 'new' && (
        <>
          <p className={styles.section}>New investment</p>
          <AssetFields type={type} onType={setType} describe={describe} error={error} />
          <p className={styles.section}>Transaction</p>
        </>
      )}

      <TextField
        label="Date"
        name="date"
        type="date"
        defaultValue={row?.date ?? today()}
        {...describe('date')}
      />
      {error('date')}

      <div hidden={!trade} style={{ display: trade ? 'contents' : undefined }}>
        <FieldPair>
          <TextField
            label={shares ? 'Shares' : 'Units'}
            placeholder="0"
            {...figure('units')}
            {...describe('units')}
          />
          <TextField
            label="Price per unit"
            placeholder="0.00"
            {...figure('price')}
            {...describe('price')}
          />
        </FieldPair>
        {error('units')}
        {error('price')}
        <TextField
          label="Fees and charges (optional)"
          placeholder="0"
          {...figure('fees')}
          {...describe('fees')}
        />
        {error('fees')}
      </div>

      <div
        hidden={action !== 'split'}
        style={{ display: action === 'split' ? 'contents' : undefined }}
      >
        <FieldPair>
          <TextField
            label="Units before"
            name="splitFrom"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1"
            defaultValue={row?.splitFrom ?? ''}
            {...describe('splitFrom')}
          />
          <TextField
            label="Units after"
            name="splitTo"
            inputMode="numeric"
            autoComplete="off"
            placeholder="5"
            defaultValue={row?.splitTo ?? ''}
            {...describe('splitFrom')}
          />
        </FieldPair>
        {error('splitFrom')}
      </div>

      {!trade && action !== 'split' && (
        <>
          <TextField
            label={AMOUNT_LABELS[action] ?? 'Amount'}
            placeholder="0"
            {...figure('amount')}
            {...describe('amount')}
          />
          {error('amount')}
        </>
      )}

      {action !== 'split' && (
        <>
          <SelectField
            label={PAID.includes(action) ? 'Paid from' : 'Received in'}
            name="accountId"
            defaultValue={row?.accountId ?? ''}
            {...describe('accountId')}
          >
            <option value="">Not linked to an account</option>
            {accountChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
          {error('accountId')}
        </>
      )}

      <TextField
        label="Note (optional)"
        name="note"
        autoComplete="off"
        defaultValue={row?.note ?? ''}
        {...describe('note')}
      />
      {error('note')}

      {action !== 'split' && (
        <FormTotal
          label={TOTAL_LABELS[action]}
          value={total === null ? '—' : `₹${formatAmount(total, 2)}`}
        />
      )}
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}

/* ---------- investment details ---------- */

/** Name, kind, class and reference, plus rate and dates where the kind has them. */
function AssetFields({
  asset,
  type,
  onType,
  describe,
  error,
}: Plumbing & { asset?: AssetOption; type: AssetType; onType: (t: AssetType) => void }) {
  const { compounding } = useContext(Context);
  const hasRate = type === 'fixed_deposit' || type === 'bond';
  const hasDates = hasRate || type === 'ppf';
  return (
    <>
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={80}
        defaultValue={asset?.name ?? ''}
        {...describe('name')}
      />
      {error('name')}
      <FieldPair>
        <SelectField
          label="Kind"
          name="type"
          value={type}
          onChange={(e) => onType(e.target.value as AssetType)}
          {...describe('type')}
        >
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={asset ? 'kept' : type}
          label="Asset class"
          name="assetClass"
          defaultValue={asset?.assetClass ?? defaultAssetClass(type)}
          {...describe('assetClass')}
        >
          {ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {ASSET_CLASS_LABELS[c]}
            </option>
          ))}
        </SelectField>
      </FieldPair>
      {error('type')}
      {error('assetClass')}
      <TextField
        label="Folio, demat or account number (optional)"
        name="accountRef"
        autoComplete="off"
        maxLength={60}
        defaultValue={asset?.accountRef ?? ''}
        {...describe('accountRef')}
      />
      {error('accountRef')}
      {type === 'mutual_fund' && (
        <>
          <TextField
            label="First NAV date (NFO only)"
            name="navStartDate"
            type="date"
            defaultValue={asset?.navStartDate ?? ''}
            {...describe('navStartDate')}
          />
          <p className={styles.hint}>
            Leave blank for existing funds. Past-price fetch skips dates before this date.
          </p>
          {error('navStartDate')}
        </>
      )}
      {hasRate && (
        <>
          <FieldPair>
            <TextField
              label="Interest rate (% a year)"
              name="interestRate"
              inputMode="decimal"
              autoComplete="off"
              placeholder="7.1"
              defaultValue={asset?.interestRate ?? ''}
              {...describe('interestRate')}
            />
            <SelectField
              label="Interest added"
              name="compounding"
              defaultValue={asset?.compounding ?? compounding}
              {...describe('compounding')}
            >
              {COMPOUNDING.map((c) => (
                <option key={c} value={c}>
                  {COMPOUNDING_LABELS[c]}
                </option>
              ))}
            </SelectField>
          </FieldPair>
          {error('interestRate')}
          {error('compounding')}
        </>
      )}
      {hasDates && (
        <>
          <FieldPair>
            <TextField
              label={type === 'fixed_deposit' ? 'Start date' : 'Start date (optional)'}
              name="startDate"
              type="date"
              defaultValue={asset?.startDate ?? (type === 'fixed_deposit' ? today() : '')}
              {...describe('startDate')}
            />
            <TextField
              label="Maturity date (optional)"
              name="maturityDate"
              type="date"
              defaultValue={asset?.maturityDate ?? ''}
              {...describe('maturityDate')}
            />
          </FieldPair>
          {error('startDate')}
          {error('maturityDate')}
        </>
      )}
    </>
  );
}

function AssetForm({ asset, onDone }: { asset: AssetOption; onDone: () => void }) {
  const [type, setType] = useState<AssetType>(asset.type);
  const { submit, pending, describe, error, formError } = useSubmit(
    (data) => saveAsset(asset.id, data),
    onDone,
  );
  return (
    <form
      id={FORM}
      onSubmit={(e) => submit(e, 'Changes saved')}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <AssetFields asset={asset} type={type} onType={setType} describe={describe} error={error} />
      <TextField
        label="Symbol or code (optional)"
        name="symbol"
        autoComplete="off"
        maxLength={40}
        defaultValue={asset.symbol ?? ''}
        {...describe('symbol')}
        aria-describedby={error('symbol') ? 'h-symbol e-symbol' : 'h-symbol'}
      />
      <p className={styles.hint} id="h-symbol">
        The ISIN, for example INF000XX0000. Needed for automatic prices.
      </p>
      {error('symbol')}
      <TextField
        label="Note (optional)"
        name="note"
        autoComplete="off"
        maxLength={200}
        defaultValue={asset.note ?? ''}
        {...describe('note')}
      />
      {error('note')}
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}

/* ---------- prices and values ---------- */

function updateWords(assets: AssetOption[]) {
  const one = assets.length === 1;
  if (assets.every((a) => a.valuation === 'units')) {
    return one
      ? { title: 'Update price', save: 'Save price', done: 'Price saved' }
      : { title: 'Update prices', save: 'Save prices', done: 'Prices saved' };
  }
  if (assets.every((a) => a.valuation === 'manual')) {
    return one
      ? { title: 'Update value', save: 'Save value', done: 'Value saved' }
      : { title: 'Update values', save: 'Save values', done: 'Values saved' };
  }
  return { title: 'Update prices and values', save: 'Save updates', done: 'Updates saved' };
}

function lastKnown(a: AssetOption): string {
  if (a.valuation === 'manual') return `Last value ₹${formatAmount(a.value)}`;
  if (!a.lastPrice) return 'No price yet';
  return a.priceDate
    ? `Last price ${a.lastPrice} on ${formatDate(a.priceDate)}`
    : `No price yet. Last bought at ${a.lastPrice}.`;
}

function UpdatesForm({
  assets,
  done,
  onDone,
}: {
  assets: AssetOption[];
  done: string;
  onDone: () => void;
}) {
  const { submit, pending, describe, error, formError } = useSubmit(saveUpdates, onDone);
  return (
    <form
      id={FORM}
      onSubmit={(e) => submit(e, done)}
      noValidate
      aria-busy={pending}
      style={{ display: 'contents' }}
    >
      <TextField
        label="As of"
        name="date"
        type="date"
        defaultValue={today()}
        {...describe('date')}
      />
      {error('date')}
      {assets.map((a, i) => {
        const key = `u-${a.id}`;
        const bad = 'invalid' in describe(key);
        return (
          <div key={a.id} style={{ display: 'contents' }}>
            <TextField
              label={a.valuation === 'manual' ? `${a.name} (₹)` : a.name}
              name={key}
              inputMode="decimal"
              autoComplete="off"
              autoFocus={i === 0}
              placeholder={a.valuation === 'manual' ? 'Value on the statement' : 'New price'}
              invalid={bad}
              aria-describedby={bad ? `h-${a.id} e-${key}` : `h-${a.id}`}
            />
            <p className={styles.hint} id={`h-${a.id}`}>
              {lastKnown(a)}
            </p>
            {error(key)}
          </div>
        );
      })}
      <p className="footnote">
        Leave a field empty to keep its current{' '}
        {assets.some((a) => a.valuation === 'units') ? 'price' : 'value'}.
      </p>
      {formError && <FieldError>{formError}</FieldError>}
    </form>
  );
}

/* ---------- buttons and menus ---------- */

export function AddInvestmentButton() {
  const { open } = useContext(Context);
  return (
    <Button icon="plus" hideLabelOnMobile onClick={() => open({ kind: 'txn' })}>
      Add investment
    </Button>
  );
}

/** A small "Add" link, e.g. beside an investment type with no holdings yet. `label` names what it adds. */
export function AddInvestmentLink({ label }: { label: string }) {
  const { open } = useContext(Context);
  return (
    <button
      type="button"
      className="linkish"
      aria-label={label}
      onClick={() => open({ kind: 'txn' })}
    >
      Add
    </button>
  );
}

export function RecordTransactionButton({ assetId }: { assetId?: number }) {
  const { open } = useContext(Context);
  return (
    <Button icon="plus" hideLabelOnMobile onClick={() => open({ kind: 'txn', assetId })}>
      Record transaction
    </Button>
  );
}

function useFetchPrices(ids: number[]) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const fetchPrices = () => {
    if (pending) return;
    start(async () => {
      try {
        const result = await fetchInvestmentPrices(ids);
        toast(result.ok ? (result.updated === 1 ? 'Price fetched' : 'Prices fetched') : result.message);
        if (result.ok) router.refresh();
      } catch {
        toast("Prices couldn't be fetched. Check the connection and try again.");
      }
    });
  };
  return { fetchPrices, pending };
}

export function FetchPricesButton({
  ids,
  label,
  variant = 'icon',
}: {
  ids: number[];
  label: string;
  variant?: 'icon' | 'button';
}) {
  const { fetchPrices, pending } = useFetchPrices(ids);
  if (ids.length === 0) return null;
  return variant === 'icon' ? (
    <IconButton icon="refresh" label={pending ? 'Fetching prices' : label} onClick={fetchPrices} aria-disabled={pending} />
  ) : (
    <Button variant="secondary" icon="refresh" onClick={fetchPrices} aria-disabled={pending}>
      {pending ? 'Fetching prices…' : label}
    </Button>
  );
}

/** Opens the statement-value drawer for assets that cannot receive feed prices. */
export function UpdateValuesButton({ ids, label, variant = 'icon' }: {
  ids: number[];
  label: string;
  variant?: 'icon' | 'button';
}) {
  const { open } = useContext(Context);
  if (ids.length === 0) return null;
  return variant === 'icon' ? (
    <IconButton icon="refresh" label={label} onClick={() => open({ kind: 'updates', ids })} />
  ) : (
    <Button variant="secondary" icon="refresh" onClick={() => open({ kind: 'updates', ids })}>
      {label}
    </Button>
  );
}

function useArchive() {
  const toast = useToast();
  return async function archive(id: number, archived: boolean) {
    const result = await setAssetArchived(id, archived);
    if (!result.ok) return toast(result.message);
    if (!archived) return toast('Investment unarchived');
    toast('Investment archived', {
      label: 'Undo',
      onClick: async () => {
        const undone = await setAssetArchived(id, false);
        toast(undone.ok ? 'Investment unarchived' : undone.message);
      },
    });
  };
}

/** The ⋮ menu on a holding. `compact` is the detail page's version, whose other actions are buttons. */
export function HoldingRowMenu({ asset, compact }: { asset: AssetOption; compact?: boolean }) {
  const { open } = useContext(Context);
  const router = useRouter();
  const archive = useArchive();
  const { fetchPrices } = useFetchPrices([asset.id]);
  const edit = { label: 'Edit investment', onSelect: () => open({ kind: 'asset', id: asset.id }) };
  const archiveItem = asset.archived
    ? { label: 'Unarchive', onSelect: () => archive(asset.id, false) }
    : { label: 'Archive', onSelect: () => archive(asset.id, true) };
  const items = compact
    ? [edit, archiveItem]
    : [
        { label: 'Record transaction', onSelect: () => open({ kind: 'txn', assetId: asset.id }) },
        ...(asset.valuation === 'fd' || asset.sold
          ? []
          : [
              {
                label: asset.valuation === 'units' ? 'Fetch price' : 'Update value',
                onSelect: asset.valuation === 'units'
                  ? fetchPrices
                  : () => open({ kind: 'updates', ids: [asset.id] }),
              },
            ]),
        {
          label: 'See transactions',
          onSelect: () => router.push(`/investments/transactions?asset=${asset.id}`),
        },
        edit,
        archiveItem,
      ];
  return <Menu label={`Actions for ${asset.name}`} items={items} />;
}

/** The ⋮ menu on an investment transaction. Delete takes the linked Money row with it. */
export function InvestmentTxnMenu({ row }: { row: InvTxnRow }) {
  const { open } = useContext(Context);
  const toast = useToast();

  async function remove() {
    const result = await deleteInvestmentTxn(row.id);
    if (!result.ok) return toast(result.message);
    const token = result.undo;
    toast('Transaction deleted', {
      label: 'Undo',
      onClick: async () => {
        const undone = token ? await undoInvestmentDelete(token) : null;
        toast(
          undone?.ok
            ? 'Transaction restored'
            : (undone?.message ?? 'Too late to undo that delete.'),
        );
      },
    });
  }

  return (
    <Menu
      label={`Actions for ${ACTION_LABELS[row.action].toLowerCase()} of ${row.assetName} on ${formatDate(row.date)}`}
      items={[
        { label: 'Edit', onSelect: () => open({ kind: 'txn', row }) },
        { label: 'Delete', onSelect: remove, danger: true },
      ]}
    />
  );
}

/** Opens the edit drawer for `?edit=<id>` (from a linked Money row), then drops the parameter. */
export function OpenFromUrl({ row }: { row: InvTxnRow | null }) {
  const { open } = useContext(Context);
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (row) open({ kind: 'txn', row });
    else toast('That investment transaction no longer exists.');
    const next = new URLSearchParams(params);
    next.delete('edit');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [row, open, toast, router, pathname, params]);

  return null;
}
