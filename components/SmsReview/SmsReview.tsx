'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/Button/Button';
import { ChipLinks } from '@/components/Chips/Chips';
import { FieldError } from '@/components/Field/Field';
import { SmsShortcutsDrawer, useSmsShortcutsEnabled } from '@/components/SmsShortcuts/SmsShortcuts';
import { Tag } from '@/components/Tag/Tag';
import { useToast } from '@/components/Toast/Toast';
import { approveSmsBatch, rejectSmsBatch, undoSmsReject } from '@/lib/actions/sms';
import type { IsoDate } from '@/lib/domain/dates';
import { formatAmount, formatINR, formatDate, MINUS } from '@/lib/domain/format';
import type { Paise } from '@/lib/domain/money';
import {
  SMS_QUEUE_FILTERS,
  SMS_QUEUE_SORTS,
  smsMissingText,
  smsNeighbours,
  smsQueueKind,
  smsReadiness,
  smsReviewHref,
  type SmsFlow,
  type SmsMissing,
  type SmsQueueFilter,
  type SmsQueueSort,
} from '@/lib/domain/smsReview';
import styles from './SmsReview.module.css';

/** One pending SMS in the queue, with the account and category Hisaab would use. */
export type SmsQueueItem = {
  id: number;
  sender: string;
  /** 'Today 9:42 am', worked out on the server so both renders agree. */
  received: string;
  direction: SmsFlow | null;
  amount: Paise | null;
  transactionDate: IsoDate | null;
  description: string;
  reason: string | null;
  accountId: number | null;
  categoryId: number | null;
  canLearn: boolean;
};

type AccountChoice = { id: number; name: string; archived: boolean };
type CategoryChoice = { id: number; name: string; kind: SmsFlow; archived: boolean };

const KIND_LABELS = {
  out: 'Money out',
  in: 'Money in',
  unclear: 'Flow unclear',
  other: 'Maybe not a transaction',
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** '−₹1,240.00' for money out, '+₹500.00' for money in, plain when the flow is unclear. */
function amountText(item: Pick<SmsQueueItem, 'amount' | 'direction'>): string | null {
  if (item.amount === null) return null;
  const sign = item.direction === 'expense' ? MINUS : item.direction === 'income' ? '+' : '';
  return sign + formatINR(item.amount, 2);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)
  );
}

/**
 * Money -> SMS -> Review: the queue on the left and the open message on the right.
 * Ticking messages swaps the message for a bulk summary. On phones the list and the
 * message are separate screens, chosen by whether a message is open.
 */
export function SmsReviewWorkspace({
  items,
  total,
  counts,
  filter,
  sort,
  open,
  showingMessage,
  accounts,
  categories,
  children,
}: {
  /** Pending SMS in the current filter and sort. */
  items: SmsQueueItem[];
  total: number;
  counts: Record<SmsQueueFilter, number>;
  filter: SmsQueueFilter;
  sort: SmsQueueSort;
  /** The open message, if it is still pending. */
  open: number | null;
  /** True when the URL asks for a message, even one that has gone. */
  showingMessage: boolean;
  accounts: AccountChoice[];
  categories: CategoryChoice[];
  /** The message pane, rendered on the server. */
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const shortcuts = useSmsShortcutsEnabled();
  const [helpOpen, setHelpOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [override, setOverride] = useState({ account: '', expense: '', income: '' });
  const [teach, setTeach] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [working, startWork] = useTransition();

  const listHref = smsReviewHref({ filter, sort });
  const hrefFor = (id: number) => smsReviewHref({ message: id, filter, sort });
  const ids = items.map((item) => item.id);
  const place = smsNeighbours(ids, open);

  const choices = {
    accounts: accounts.map(({ id, archived }) => ({ id, archived })),
    categories: categories.map(({ id, kind, archived }) => ({ id, kind, archived })),
  };
  const selected = items
    .filter((item) => picked.has(item.id))
    .map((item) => {
      const accountId = override.account ? Number(override.account) : item.accountId;
      const categoryOverride =
        item.direction === 'income'
          ? override.income
          : item.direction === 'expense'
            ? override.expense
            : '';
      const categoryId = categoryOverride ? Number(categoryOverride) : item.categoryId;
      const readiness = smsReadiness(
        {
          direction: item.direction,
          amount: item.amount,
          transactionDate: item.transactionDate,
          accountId,
          categoryId,
        },
        choices,
      );
      return { ...item, accountId, categoryId, ...readiness };
    });
  const ready = selected.filter((item) => item.ready);
  const notReady = selected.filter((item) => !item.ready);
  const bulk = selected.length > 0;
  const pane = bulk ? 'bulk' : showingMessage ? 'detail' : 'list';
  const allPicked = items.length > 0 && items.every((item) => picked.has(item.id));
  const somePicked = items.some((item) => picked.has(item.id));

  function clearSelection() {
    setPicked(new Set());
    setOverride({ account: '', expense: '', income: '' });
    setTeach(false);
    setBulkError('');
  }

  function toggle(id: number) {
    setBulkError('');
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setBulkError('');
    setPicked(allPicked ? new Set() : new Set(ids));
  }

  function approveReady() {
    if (!ready.length || working) return;
    const decided = new Set(ready.map((item) => item.id));
    startWork(async () => {
      const result = await approveSmsBatch({
        items: ready.map(({ id, accountId, categoryId }) => ({ id, accountId, categoryId })),
        learn: teach,
      });
      if (!result.ok) {
        setBulkError(result.message);
        return;
      }
      toast(result.message);
      clearSelection();
      if (open !== null && decided.has(open)) router.replace(listHref, { scroll: false });
    });
  }

  function rejectSelected() {
    if (!selected.length || working) return;
    const decided = selected.map((item) => item.id);
    startWork(async () => {
      const result = await rejectSmsBatch(decided);
      if (!result.ok) {
        setBulkError(result.message);
        return;
      }
      const token = result.undo;
      toast(
        result.message,
        token
          ? {
              label: 'Undo',
              onClick: async () => {
                const undone = await undoSmsReject(token);
                toast(undone.message);
              },
            }
          : undefined,
      );
      clearSelection();
      if (open !== null && decided.includes(open)) router.replace(listHref, { scroll: false });
    });
  }

  // Shortcuts press the button they belong to, so a disabled button stays disabled.
  useEffect(() => {
    if (!shortcuts) return;
    function press(keys: string) {
      const target = root.current?.querySelector<HTMLElement>(`[aria-keyshortcuts="${keys}"]`);
      if (!target || target.matches(':disabled')) return false;
      target.click();
      return true;
    }
    function go(id: number | null) {
      if (id !== null) router.push(smsReviewHref({ message: id, filter, sort }), { scroll: false });
    }
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector('dialog[open]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      let handled = true;
      if (key === '?') setHelpOpen(true);
      else if (key === 'Escape' && picked.size) clearSelection();
      else if (key === 'j') go(place.index === -1 ? (ids[0] ?? null) : place.next);
      else if (key === 'k') go(place.index === -1 ? (ids[0] ?? null) : place.prev);
      else if (key === 'x') {
        if (open !== null && ids.includes(open)) toggle(open);
        else handled = false;
      } else if (key === 'a') handled = press(event.shiftKey ? 'Shift+A' : 'A');
      else if (key === 'r') handled = press(event.shiftKey ? 'Shift+R' : 'R');
      else if (key === 'l' && !event.shiftKey) handled = press('L');
      else if (key === 's' && !event.shiftKey) handled = press('S');
      else handled = false;
      if (handled) event.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /** Up and down move between rows while the list has focus, like a list box. */
  function onListKey(event: ReactKeyboardEvent<HTMLOListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>('a[data-row]') ?? [])];
    const at = links.findIndex((link) => link.contains(document.activeElement));
    const next = links[at + (event.key === 'ArrowDown' ? 1 : -1)] ?? links[at];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  const position = place.index >= 0 ? `Showing SMS ${place.index + 1} of ${place.total}.` : '';

  return (
    <div className={styles.workspace} data-pane={pane} ref={root}>
      <section className={styles.queue} aria-labelledby="sms-queue-title">
        <h3 className="sr-only" id="sms-queue-title">
          Waiting for review
        </h3>
        <div className={styles.toolbar}>
          <label className={styles.all}>
            <input
              type="checkbox"
              checked={allPicked}
              ref={(input) => {
                if (input) input.indeterminate = somePicked && !allPicked;
              }}
              onChange={toggleAll}
              disabled={items.length === 0}
            />
            <span className="sr-only">Select all SMS shown</span>
          </label>
          {bulk ? (
            <div className={styles.bulkBar}>
              <p className={styles.bulkSummary} role="status">
                <strong>{selected.length} selected</strong>
                <span>{ready.length} ready to approve</span>
                {notReady.length > 0 && <span>{notReady.length} need details</span>}
              </p>
              <div className={styles.bulkActions}>
                <Button
                  onClick={approveReady}
                  disabled={!ready.length || working}
                  aria-keyshortcuts="Shift+A"
                >
                  {ready.length ? `Approve ${ready.length} ready` : 'None ready'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={rejectSelected}
                  disabled={working}
                  aria-keyshortcuts="Shift+R"
                >
                  Reject {selected.length}
                </Button>
                <button type="button" className="linkish" onClick={clearSelection}>
                  Clear selection
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.views}>
              <ChipLinks
                label="Show"
                items={SMS_QUEUE_FILTERS.map((option) => ({
                  href: smsReviewHref({ filter: option.value, sort }),
                  label: option.label,
                  count: counts[option.value],
                  current: option.value === filter,
                }))}
              />
              <label className={styles.sort}>
                <span className="sr-only">Sort</span>
                <select
                  value={sort}
                  onChange={(event) =>
                    router.replace(
                      smsReviewHref({
                        message: open,
                        filter,
                        sort: event.target.value as SmsQueueSort,
                      }),
                      { scroll: false },
                    )
                  }
                >
                  {SMS_QUEUE_SORTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className={styles.queueEmpty}>
            <p>No SMS match this filter.</p>
            <Link href={smsReviewHref({ filter: 'all', sort })} scroll={false}>
              Show all {total}
            </Link>
          </div>
        ) : (
          <ol className={styles.rows} ref={list} onKeyDown={onListKey}>
            {items.map((item) => {
              const amount = amountText(item);
              const current = item.id === open;
              const pick = selected.find((row) => row.id === item.id);
              return (
                <li key={item.id} className={styles.row} data-current={current || undefined}>
                  <input
                    type="checkbox"
                    className={styles.pick}
                    checked={picked.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select SMS from ${item.sender}, ${amount ?? 'amount unclear'}`}
                  />
                  <Link
                    href={hrefFor(item.id)}
                    data-row
                    className={styles.rowLink}
                    aria-current={current ? 'true' : undefined}
                    prefetch={false}
                    scroll={false}
                    onClick={() => {
                      if (bulk) clearSelection();
                    }}
                  >
                    <span className={styles.rowTop}>
                      <span className={styles.sender}>{item.sender}</span>
                      {amount ? (
                        <span
                          className={`${styles.amount} ${item.direction === 'income' ? 'pos' : ''}`}
                        >
                          {amount}
                        </span>
                      ) : (
                        <span className={styles.noAmount}>Amount unclear</span>
                      )}
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{KIND_LABELS[smsQueueKind(item)]}</span>
                      <span>{item.received}</span>
                      {pick && (
                        <Tag tone={pick.ready ? 'primary' : 'quiet'}>
                          {pick.ready ? 'Ready' : 'Needs details'}
                        </Tag>
                      )}
                    </span>
                    {item.reason && <span className={styles.reason}>{item.reason}</span>}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}

        <p className={styles.hint}>
          {shortcuts ? (
            <span aria-hidden="true">J/K move · X select · A approve · R reject · </span>
          ) : (
            <span>Keyboard shortcuts are off. </span>
          )}
          <button type="button" className="linkish" onClick={() => setHelpOpen(true)}>
            {shortcuts ? '? All shortcuts' : 'Keyboard shortcuts'}
          </button>
        </p>
      </section>

      <div className={styles.detail}>
        {bulk ? (
          <BulkPanel
            ready={ready}
            notReady={notReady}
            accounts={accounts}
            categories={categories}
            override={override}
            onOverride={(next) => {
              setBulkError('');
              setOverride(next);
            }}
            teach={teach}
            onTeach={setTeach}
            error={bulkError}
            hrefFor={hrefFor}
            onOpen={clearSelection}
          />
        ) : (
          children
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {position}
      </p>
      <SmsShortcutsDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

type Selected = SmsQueueItem & { ready: boolean; missing: SmsMissing[] };

function BulkPanel({
  ready,
  notReady,
  accounts,
  categories,
  override,
  onOverride,
  teach,
  onTeach,
  error,
  hrefFor,
  onOpen,
}: {
  ready: Selected[];
  notReady: Selected[];
  accounts: AccountChoice[];
  categories: CategoryChoice[];
  override: { account: string; expense: string; income: string };
  onOverride: (next: { account: string; expense: string; income: string }) => void;
  teach: boolean;
  onTeach: (on: boolean) => void;
  error: string;
  hrefFor: (id: number) => string;
  onOpen: () => void;
}) {
  const all = [...ready, ...notReady];
  const activeAccounts = accounts.filter((account) => !account.archived);
  const kinds = (['expense', 'income'] as const).filter((kind) =>
    all.some((item) => item.direction === kind),
  );
  const name = (list: { id: number; name: string }[], id: number | null) =>
    list.find((entry) => entry.id === id)?.name ?? '';
  const net = ready.reduce(
    (sum, item) => sum + (item.direction === 'income' ? item.amount! : -item.amount!),
    0,
  );
  const learnable = ready.filter((item) => item.canLearn).length;

  return (
    <section className={styles.bulk} aria-labelledby="sms-bulk-title">
      <header>
        <h3 className={styles.bulkTitle} id="sms-bulk-title">
          {ready.length
            ? `Approve ${plural(ready.length, 'transaction', 'transactions')}`
            : 'Nothing ready to approve yet'}
        </h3>
        <p className={styles.bulkSub}>
          {notReady.length
            ? `${plural(notReady.length, 'SMS needs', 'SMS need')} more details. Set them below or open each one.`
            : 'Every selected SMS has what it needs. Check the list, then approve.'}
        </p>
      </header>

      <fieldset className={styles.overrides}>
        <legend>Set for all selected</legend>
        <label>
          <span>Account</span>
          <select
            value={override.account}
            onChange={(event) => onOverride({ ...override, account: event.target.value })}
          >
            <option value="">Keep each SMS&apos;s account</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        {kinds.map((kind) => (
          <label key={kind}>
            <span>{kind === 'income' ? 'Income category' : 'Spending category'}</span>
            <select
              value={override[kind]}
              onChange={(event) => onOverride({ ...override, [kind]: event.target.value })}
            >
              <option value="">Keep each SMS&apos;s category</option>
              {categories
                .filter((category) => category.kind === kind && !category.archived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </fieldset>

      {ready.length > 0 && (
        <div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className="sr-only">SMS ready to approve</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Account</th>
                  <th scope="col">Category</th>
                  <th scope="col" className={styles.num}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {ready.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.date}>{formatDate(item.transactionDate!)}</td>
                    <td>{item.description}</td>
                    <td>{name(accounts, item.accountId)}</td>
                    <td>{name(categories, item.categoryId)}</td>
                    <td className={`${styles.num} ${item.direction === 'income' ? 'pos' : ''}`}>
                      {item.direction === 'income' ? '+' : MINUS}
                      {formatAmount(item.amount!, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Net</td>
                  <td className={`${styles.num} ${net > 0 ? 'pos' : ''}`}>
                    {net > 0 ? '+' : ''}
                    {formatAmount(net, 2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="footnote">All amounts in ₹.</p>
        </div>
      )}

      {notReady.length > 0 && (
        <div className={styles.missing}>
          <h4>Needs details</h4>
          <ul>
            {notReady.map((item) => (
              <li key={item.id}>
                <span className={styles.sender}>{item.sender}</span>{' '}
                <span>{smsMissingText(item.missing)}</span>{' '}
                <Link href={hrefFor(item.id)} scroll={false} onClick={onOpen}>
                  Open it to finish
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {learnable > 0 && (
        <div className={styles.teach}>
          <label>
            <input
              type="checkbox"
              checked={teach}
              onChange={(event) => onTeach(event.target.checked)}
              aria-describedby="sms-teach-note"
            />
            Teach rules for these senders
          </label>
          <p id="sms-teach-note">
            Future SMS with the same sender and wording will be imported automatically.
            {learnable < ready.length &&
              ` ${plural(ready.length - learnable, 'SMS', 'SMS')} can't teach a rule and will only be approved.`}
          </p>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
    </section>
  );
}
