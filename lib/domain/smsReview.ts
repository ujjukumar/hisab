import { addDays, isValidDate, type IsoDate } from './dates';
import { formatDate, formatDay } from './format';
import type { Paise } from './money';

/**
 * Pure helpers for Money -> SMS. Nothing here touches Node APIs, so client
 * components can use them too (the parser in sms.ts needs node:crypto).
 */

export type SmsFlow = 'income' | 'expense';

/* ---------- queue ---------- */

export type SmsQueueKind = 'out' | 'in' | 'unclear' | 'other';
export type SmsQueueFilter = 'all' | SmsQueueKind;
export type SmsQueueSort = 'new' | 'old' | 'amount';

export const SMS_QUEUE_FILTERS: { value: SmsQueueFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'out', label: 'Money out' },
  { value: 'in', label: 'Money in' },
  { value: 'unclear', label: 'Unclear' },
  { value: 'other', label: 'Not a transaction' },
];

export const SMS_QUEUE_SORTS: { value: SmsQueueSort; label: string }[] = [
  { value: 'new', label: 'Newest first' },
  { value: 'old', label: 'Oldest first' },
  { value: 'amount', label: 'Largest amount' },
];

/** Which filter chip a pending SMS falls under. No flow and no amount means it is not a payment. */
export function smsQueueKind(message: {
  direction: SmsFlow | null;
  amount: Paise | null;
}): SmsQueueKind {
  if (message.direction === 'expense') return 'out';
  if (message.direction === 'income') return 'in';
  return message.amount === null ? 'other' : 'unclear';
}

export function parseQueueFilter(value: unknown): SmsQueueFilter {
  return SMS_QUEUE_FILTERS.some((f) => f.value === value) ? (value as SmsQueueFilter) : 'all';
}

export function parseQueueSort(value: unknown): SmsQueueSort {
  return SMS_QUEUE_SORTS.some((s) => s.value === value) ? (value as SmsQueueSort) : 'new';
}

type QueueRow = {
  id: number;
  receivedAt: string;
  direction: SmsFlow | null;
  amount: Paise | null;
};

/** Filter and sort the review queue, and count every chip from the unfiltered list. */
export function smsQueueView<T extends QueueRow>(
  rows: T[],
  filter: SmsQueueFilter,
  sort: SmsQueueSort,
): { rows: T[]; counts: Record<SmsQueueFilter, number> } {
  const counts: Record<SmsQueueFilter, number> = {
    all: rows.length,
    out: 0,
    in: 0,
    unclear: 0,
    other: 0,
  };
  for (const row of rows) counts[smsQueueKind(row)] += 1;
  const time = (row: QueueRow) => Date.parse(row.receivedAt) || 0;
  const shown = rows
    .filter((row) => filter === 'all' || smsQueueKind(row) === filter)
    .sort((a, b) => {
      if (sort === 'amount') {
        const diff = (b.amount ?? -1) - (a.amount ?? -1);
        if (diff !== 0) return diff;
      }
      const byTime = sort === 'old' ? time(a) - time(b) : time(b) - time(a);
      return byTime || (sort === 'old' ? a.id - b.id : b.id - a.id);
    });
  return { rows: shown, counts };
}

/**
 * Where to go from the open message: the pager's neighbours, the message to show
 * once this one is decided (`after`), and the one Skip moves to, wrapping round.
 */
export function smsNeighbours(ids: number[], current: number | null) {
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) {
    return {
      index: -1,
      total: ids.length,
      prev: null,
      next: null,
      after: ids[0] ?? null,
      skip: ids[0] ?? null,
    };
  }
  const prev = ids[index - 1] ?? null;
  const next = ids[index + 1] ?? null;
  const first = ids[0] !== current ? (ids[0] ?? null) : null;
  return { index, total: ids.length, prev, next, after: next ?? prev, skip: next ?? first };
}

/** The review URL for one message, keeping the queue's filter and sort. Defaults stay out of the URL. */
export function smsReviewHref(view: {
  message?: number | null;
  filter: SmsQueueFilter;
  sort: SmsQueueSort;
}): string {
  const params = new URLSearchParams();
  if (view.message) params.set('message', String(view.message));
  if (view.filter !== 'all') params.set('filter', view.filter);
  if (view.sort !== 'new') params.set('sort', view.sort);
  const query = params.toString();
  return query ? `/money/sms?${query}` : '/money/sms';
}

/* ---------- received times, always in India time ---------- */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

function istParts(value: string | Date) {
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + IST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return { date, time };
}

/** The India calendar date of a timestamp, whatever offset the phone sent. Null when unreadable. */
export function istDate(value: string | Date): IsoDate | null {
  return istParts(value)?.date ?? null;
}

/** 'Today 9:42 am', 'Yesterday 6:30 pm', '9 Oct', or '9 Oct 2025' for another year. */
export function formatReceived(iso: string, now: Date | string = new Date()): string {
  const at = istParts(iso);
  const today = istParts(now);
  if (!at || !today) return '';
  if (at.date === today.date) return `Today ${at.time}`;
  if (at.date === addDays(today.date, -1)) return `Yesterday ${at.time}`;
  return at.date.slice(0, 4) === today.date.slice(0, 4) ? formatDay(at.date) : formatDate(at.date);
}

/** '11 Oct 2026, 9:42 am', for the open message. */
export function formatReceivedFull(iso: string): string {
  const at = istParts(iso);
  return at ? `${formatDate(at.date)}, ${at.time}` : '';
}

/* ---------- approving without opening each message ---------- */

export type SmsMissing = 'direction' | 'amount' | 'date' | 'account' | 'category';

type AccountChoice = { id: number; archived: boolean };
type CategoryChoice = { id: number; kind: SmsFlow; archived: boolean };

export type ReadinessInput = {
  direction: SmsFlow | null;
  amount: Paise | null;
  transactionDate: IsoDate | null;
  accountId: number | null;
  categoryId: number | null;
};

/** A message is ready when it can become a transaction without anything else from the owner. */
export function smsReadiness(
  message: ReadinessInput,
  choices: { accounts: AccountChoice[]; categories: CategoryChoice[] },
): { ready: boolean; missing: SmsMissing[] } {
  const missing: SmsMissing[] = [];
  if (!message.direction) missing.push('direction');
  if (message.amount === null || message.amount <= 0) missing.push('amount');
  if (!message.transactionDate || !isValidDate(message.transactionDate)) missing.push('date');
  if (!choices.accounts.some((a) => a.id === message.accountId && !a.archived))
    missing.push('account');
  const category = choices.categories.find((c) => c.id === message.categoryId && !c.archived);
  if (!category || (message.direction && category.kind !== message.direction))
    missing.push('category');
  return { ready: missing.length === 0, missing };
}

const MISSING_WORDS: Record<SmsMissing, string> = {
  direction: 'money in or out',
  amount: 'an amount',
  date: 'a date',
  account: 'an account',
  category: 'a category',
};

/** 'Choose money in or out, an account and a category.' */
export function smsMissingText(missing: SmsMissing[]): string {
  const words = missing.map((m) => MISSING_WORDS[m]);
  if (words.length === 0) return '';
  const list =
    words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `Choose ${list}.`;
}

export type SmsApproval = {
  senderPattern: string | null;
  direction: SmsFlow | null;
  accountId: number | null;
  categoryId: number | null;
};

/**
 * The account and category the owner chose last time for the same sender and flow,
 * skipping choices that have since been archived. `history` is newest first.
 */
export function smsSuggestion(
  history: SmsApproval[],
  message: { senderPattern: string | null; direction: SmsFlow | null },
  choices: { accounts: AccountChoice[]; categories: CategoryChoice[] },
): { accountId: number; categoryId: number } | null {
  if (!message.senderPattern || !message.direction) return null;
  for (const past of history) {
    if (past.senderPattern !== message.senderPattern || past.direction !== message.direction)
      continue;
    const account = choices.accounts.find((a) => a.id === past.accountId && !a.archived);
    const category = choices.categories.find(
      (c) => c.id === past.categoryId && !c.archived && c.kind === message.direction,
    );
    if (account && category) return { accountId: account.id, categoryId: category.id };
  }
  return null;
}

/* ---------- phones and rules ---------- */

export type SmsDeviceState = 'connected' | 'no-sms' | 'waiting' | 'revoked';

export function smsDeviceStatus(device: {
  approvedAt: string | null;
  claimedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
}): { state: SmsDeviceState; label: string } {
  if (device.revokedAt) return { state: 'revoked', label: 'Revoked' };
  if (device.lastSeenAt) return { state: 'connected', label: 'Connected' };
  if (device.claimedAt) return { state: 'no-sms', label: 'Connected, no SMS yet' };
  return { state: 'waiting', label: 'Waiting for phone' };
}

/** The one-line status under the SMS heading, e.g. 'Pixel 8 connected · last SMS today 10:05 am'. */
export function smsConnectionSummary(
  devices: {
    label: string;
    approvedAt: string | null;
    claimedAt: string | null;
    lastSeenAt: string | null;
    revokedAt: string | null;
  }[],
  now: Date | string = new Date(),
): { text: string; connected: boolean } {
  const active = devices.filter((d) => d.approvedAt && !d.revokedAt);
  if (active.length === 0) return { text: 'No phone paired', connected: false };
  const connected = active.filter((d) => d.claimedAt || d.lastSeenAt);
  const lastSeen = active
    .map((d) => d.lastSeenAt)
    .filter((t): t is string => t !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const who =
    connected.length === 0
      ? active.length === 1
        ? `${active[0]!.label}: waiting for phone`
        : `${active.length} phones waiting to connect`
      : connected.length === 1
        ? `${connected[0]!.label} connected`
        : `${connected.length} phones connected`;
  const when = lastSeen
    ? formatReceived(lastSeen, now).replace(/^(Today|Yesterday)/, (word) => word.toLowerCase())
    : '';
  return {
    text:
      connected.length && !lastSeen
        ? `${who} · no SMS yet`
        : when
          ? `${who} · last SMS ${when}`
          : who,
    connected: connected.length > 0,
  };
}

/* ---------- why an SMS is waiting ---------- */

export type SmsReasonKey =
  'direction' | 'amount' | 'date' | 'rule' | 'category' | 'stale' | 'other';
export type SmsReason = { key: SmsReasonKey; short: string; long: string };

/** The parser's stored sentences, in the order they matter to the owner. */
const KNOWN_REASONS: { text: string; reason: SmsReason }[] = [
  {
    text: 'The message does not clearly say debit or credit.',
    reason: {
      key: 'direction',
      short: 'Money in or out unclear',
      long: "It doesn't say whether money came in or went out.",
    },
  },
  {
    text: 'The message does not contain one unambiguous INR amount.',
    reason: { key: 'amount', short: 'Amount unclear', long: 'It has no amount, or more than one.' },
  },
  {
    text: 'The message does not contain a valid transaction date.',
    reason: {
      key: 'date',
      short: 'No date',
      long: 'It has no transaction date, so the day it arrived is filled in.',
    },
  },
  {
    text: 'No enabled provider rule matches this sender.',
    reason: {
      key: 'rule',
      short: 'No matching rule yet',
      long: 'No rule matches this sender and wording yet.',
    },
  },
  {
    text: 'No category is configured for this direction.',
    reason: {
      key: 'category',
      short: 'Rule has no category',
      long: 'The matching rule has no category for this flow.',
    },
  },
  {
    text: 'The configured account or category no longer exists.',
    reason: {
      key: 'stale',
      short: 'Rule needs updating',
      long: "The matching rule's account or category was deleted.",
    },
  },
];

/**
 * Why a pending SMS needs the owner, in plain words. Any text Hisaab doesn't
 * recognise is kept as it is. "No category" adds nothing when no rule matched.
 */
export function smsReasons(reason: string | null): SmsReason[] {
  if (!reason) return [];
  let rest = reason;
  const found: SmsReason[] = [];
  for (const known of KNOWN_REASONS) {
    if (!rest.includes(known.text)) continue;
    rest = rest.replace(known.text, ' ');
    found.push(known.reason);
  }
  const reasons = found.some((r) => r.key === 'rule')
    ? found.filter((r) => r.key !== 'category')
    : found;
  const other = rest.replace(/\s+/g, ' ').trim();
  return other ? [...reasons, { key: 'other', short: other, long: other }] : reasons;
}

/* ---------- display helpers ---------- */

/** A learned sender pattern such as '^AX-SMPBNK-S$' shown as the sender it matches. */
export function senderLabel(pattern: string): string {
  const exact = pattern.match(/^\^(.*)\$$/);
  return exact ? exact[1]!.replace(/\\(.)/g, '$1') : pattern;
}

/** Cut text into plain and highlighted pieces. Ranges must be sorted and not overlap. */
export function highlightSegments<K extends string>(
  text: string,
  ranges: { start: number; end: number; kind: K }[],
): { text: string; kind: K | null }[] {
  const pieces: { text: string; kind: K | null }[] = [];
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, at);
    const end = Math.min(range.end, text.length);
    if (end <= start) continue;
    if (start > at) pieces.push({ text: text.slice(at, start), kind: null });
    pieces.push({ text: text.slice(start, end), kind: range.kind });
    at = end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), kind: null });
  return pieces;
}
