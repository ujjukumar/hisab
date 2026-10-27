import {
  addMonths,
  daysBetween,
  daysInMonth,
  makeDate,
  monthOf,
  parts,
  type IsoDate,
  type IsoMonth,
} from './dates';
import { formatDate, formatDay, formatINR } from './format';
import type { Paise } from './money';

/**
 * What the dashboard puts in its "Needs attention" strip (PLAN section 7).
 *
 * The rules are pure so they can be tested without a database: the page passes
 * in what it has already loaded. Nothing here reads the database, so the input
 * is described structurally rather than importing the query row types.
 */

export type AttentionItem = {
  key: 'prices' | 'no-price' | 'budgets' | 'overdrawn' | 'sms' | `card-${number}`;
  /** What is wrong, in one line. */
  text: string;
  /** What the link does about it. */
  action: string;
  href: string;
  /** 'neg' only where the loss colour is allowed: spending over its budget. */
  tone: 'neg' | '';
  /** A card bill: the card and the amount owed, so the page can offer to pay it. */
  pay?: { accountId: number; name: string; amount: Paise };
};

export type AttentionInput = {
  today: IsoDate;
  /** The month the dashboard is showing. */
  month: IsoMonth;
  /** True when `month` is the current month, so links can leave it out. */
  isCurrentMonth: boolean;
  budgets: { rows: { name: string; over: boolean }[] };
  accounts: {
    id?: number;
    name: string;
    type: string;
    balance: Paise;
    archived: boolean;
    dueDay?: number | null;
  }[];
  holdings: { name: string; stale: boolean; sold: boolean }[];
  prices: { lastOn: IsoDate | null; ok: boolean; auto: boolean };
  /** SMS from paired phones waiting for the owner in Money → SMS. */
  sms?: { pending: number };
};

/** Prices older than this are worth a nudge. Four days covers a long weekend. */
export const STALE_PRICE_DAYS = 4;

/** A card bill is worth a nudge this many days before it is due. */
export const CARD_DUE_DAYS = 7;

/** The next date a bill due on `dueDay` falls on, today included. Short months use their last day. */
export function nextDueDate(today: IsoDate, dueDay: number): IsoDate {
  const on = (month: IsoMonth) => {
    const { year, month: m } = parts(`${month}-01`);
    return makeDate(year, m, Math.min(dueDay, daysInMonth(year, m)));
  };
  const thisMonth = on(monthOf(today));
  return thisMonth >= today ? thisMonth : on(addMonths(monthOf(today), 1));
}

const plural = <T,>(list: T[], one: (item: T) => string, many: (count: number) => string) =>
  list.length === 1 ? one(list[0]!) : many(list.length);

/**
 * Only what the owner can act on, investment concerns first. Returns an empty
 * list when nothing is wrong, and the strip then renders nothing.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { prices, holdings, budgets, accounts } = input;

  // Card bills due within a week, soonest first. Nothing owed means nothing to pay.
  accounts
    .filter((a) => !a.archived && a.type === 'card' && a.dueDay && a.balance < 0 && a.id)
    .map((a) => ({ a, due: nextDueDate(input.today, a.dueDay!) }))
    .filter(({ due }) => daysBetween(input.today, due) <= CARD_DUE_DAYS)
    .sort((x, y) => x.due.localeCompare(y.due))
    .forEach(({ a, due }) => {
      const days = daysBetween(input.today, due);
      items.push({
        key: `card-${a.id!}`,
        text: `${a.name} bill of ${formatINR(-a.balance)} is due ${
          days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${formatDay(due)}, in ${days} days`
        }`,
        action: 'Pay',
        href: '/money/accounts',
        tone: '',
        pay: { accountId: a.id!, name: a.name, amount: -a.balance },
      });
    });

  // Prices. Nothing to say when the owner has switched downloads off.
  if (prices.auto) {
    if (prices.lastOn === null) {
      items.push({
        key: 'prices',
        text: 'Prices have never been updated',
        action: 'Update prices',
        href: '/settings',
        tone: '',
      });
    } else if (!prices.ok) {
      items.push({
        key: 'prices',
        text: `The price update on ${formatDate(prices.lastOn)} did not finish`,
        action: 'Try again',
        href: '/settings',
        tone: '',
      });
    } else if (daysBetween(prices.lastOn, input.today) > STALE_PRICE_DAYS) {
      items.push({
        key: 'prices',
        text: `Prices were last updated on ${formatDate(prices.lastOn)}`,
        action: 'Update prices',
        href: '/settings',
        tone: '',
      });
    }
  }

  // Holdings valued at their last buy price because no price has been entered.
  const unpriced = holdings.filter((h) => h.stale && !h.sold);
  if (unpriced.length > 0) {
    items.push({
      key: 'no-price',
      text: plural(
        unpriced,
        (h) => `${h.name} has no price yet`,
        (n) => `${n} holdings have no price yet`,
      ),
      action: unpriced.length === 1 ? 'Add a price' : 'Add prices',
      href: '/investments',
      tone: '',
    });
  }

  // Budgets spent past their limit.
  const over = budgets.rows.filter((r) => r.over);
  if (over.length > 0) {
    items.push({
      key: 'budgets',
      text: plural(
        over,
        (r) => `${r.name} is over its budget`,
        (n) => `${n} budgets are over`,
      ),
      action: 'Review budgets',
      href: input.isCurrentMonth ? '/money/budgets' : `/money/budgets?month=${input.month}`,
      tone: 'neg',
    });
  }

  // A negative balance on a card is money owed, which is normal, so cards are left out.
  const overdrawn = accounts.filter((a) => !a.archived && a.type !== 'card' && a.balance < 0);
  if (overdrawn.length > 0) {
    items.push({
      key: 'overdrawn',
      text: plural(
        overdrawn,
        (a) => `${a.name} is below zero`,
        (n) => `${n} accounts are below zero`,
      ),
      action: 'Check accounts',
      href: '/money/accounts',
      tone: '',
    });
  }

  const pendingSms = input.sms?.pending ?? 0;
  if (pendingSms > 0) {
    items.push({
      key: 'sms',
      text:
        pendingSms === 1 ? '1 SMS import needs review' : `${pendingSms} SMS imports need review`,
      action: 'Review SMS',
      href: '/money/sms',
      tone: '',
    });
  }

  return items;
}
