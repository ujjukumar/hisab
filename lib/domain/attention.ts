import { daysBetween, type IsoDate, type IsoMonth } from './dates';
import { formatDate } from './format';
import type { Paise } from './money';

/**
 * What the dashboard puts in its "Needs attention" strip (PLAN section 9).
 *
 * The rules are pure so they can be tested without a database: the page passes
 * in what it has already loaded. Nothing here reads the database, so the input
 * is described structurally rather than importing the query row types.
 */

export type AttentionItem = {
  key: 'prices' | 'no-price' | 'budgets' | 'overdrawn';
  /** What is wrong, in one line. */
  text: string;
  /** What the link does about it. */
  action: string;
  href: string;
  /** 'neg' only where the loss colour is allowed: spending over its budget. */
  tone: 'neg' | '';
};

export type AttentionInput = {
  today: IsoDate;
  /** The month the dashboard is showing. */
  month: IsoMonth;
  /** True when `month` is the current month, so links can leave it out. */
  isCurrentMonth: boolean;
  budgets: { rows: { name: string; over: boolean }[] };
  accounts: { name: string; type: string; balance: Paise; archived: boolean }[];
  holdings: { name: string; stale: boolean; sold: boolean }[];
  prices: { lastOn: IsoDate | null; ok: boolean; auto: boolean };
};

/** Prices older than this are worth a nudge. Four days covers a long weekend. */
export const STALE_PRICE_DAYS = 4;

const plural = <T,>(list: T[], one: (item: T) => string, many: (count: number) => string) =>
  list.length === 1 ? one(list[0]!) : many(list.length);

/**
 * Only what the owner can act on, investment concerns first. Returns an empty
 * list when nothing is wrong, and the strip then renders nothing.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { prices, holdings, budgets, accounts } = input;

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

  return items;
}
