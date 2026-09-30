import { Decimal } from 'decimal.js';
import type { InvestmentAction, transactions } from '@/lib/db/schema';
import type { IsoDate } from './dates';
import type { Paise } from './money';
import type { CashFlow } from './xirr';

type TransactionInsert = typeof transactions.$inferInsert;

export type HoldingTxn = {
  id: number;
  date: IsoDate;
  action: InvestmentAction;
  units: string | null;
  price: string | null;
  amount: Paise | null;
  fees: Paise;
  splitFrom: number | null;
  splitTo: number | null;
};

export type Holding = {
  units: Decimal;
  /** Paise. For units assets the average-cost basis; for manual and FD assets the net amount invested. */
  cost: Paise;
  realised: Paise;
  /** Dividends and interest paid out. */
  income: Paise;
  /** Buys, deposits and every fee. */
  outflows: Paise;
  /** Sale and withdrawal proceeds after fees. */
  inflows: Paise;
  /** Price of the last buy above zero, the fallback when no price has been entered. */
  lastBuyPrice: string | null;
  firstDate: IsoDate | null;
  /** Units held after each transaction, by transaction id. */
  unitsAfter: Map<number, Decimal>;
  /** Cash flows for XIRR, without the final value. */
  flows: CashFlow[];
};

const units = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });

export class OversellError extends Error {
  txnId: number;
  constructor(held: Decimal, txnId: number) {
    super(`You only hold ${units.format(held.toNumber())} units on that date.`);
    this.txnId = txnId;
  }
}

/** Date order, then id, the order every holding is worked out in. */
export function byDateThenId<T extends { date: IsoDate; id: number }>(a: T, b: T): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
}

/**
 * Replay an asset's transactions with average cost (PLAN section 6).
 * Throws OversellError when a sale is larger than the units held on its date.
 */
export function computeHolding(txns: HoldingTxn[]): Holding {
  let held = new Decimal(0);
  let cost = new Decimal(0);
  let realised = new Decimal(0);
  let income = 0;
  let outflows = 0;
  let inflows = 0;
  let lastBuyPrice: string | null = null;
  const unitsAfter = new Map<number, Decimal>();
  const flows: CashFlow[] = [];

  const sorted = [...txns].sort(byDateThenId);
  for (const t of sorted) {
    const amount = t.amount ?? 0;
    const u = new Decimal(t.units ?? 0);
    switch (t.action) {
      case 'buy':
      case 'deposit':
        held = t.action === 'buy' ? held.plus(u) : held;
        cost = cost.plus(amount + t.fees);
        outflows += amount + t.fees;
        flows.push({ date: t.date, amount: -(amount + t.fees) });
        if (t.action === 'buy' && t.price && new Decimal(t.price).gt(0)) lastBuyPrice = t.price;
        break;
      case 'sell': {
        if (u.gt(held)) throw new OversellError(held, t.id);
        const removed = held.isZero() ? new Decimal(0) : cost.div(held).times(u);
        realised = realised.plus(amount - t.fees).minus(removed);
        held = held.minus(u);
        cost = held.isZero() ? new Decimal(0) : cost.minus(removed);
        inflows += amount - t.fees;
        flows.push({ date: t.date, amount: amount - t.fees });
        break;
      }
      case 'withdrawal': {
        // Taking out more than was put in is growth, which counts as a realised gain.
        const excess = Decimal.max(0, new Decimal(amount).minus(cost));
        realised = realised.plus(excess).minus(t.fees);
        cost = Decimal.max(0, cost.minus(amount));
        inflows += amount - t.fees;
        flows.push({ date: t.date, amount: amount - t.fees });
        break;
      }
      case 'split':
        if (t.splitFrom && t.splitTo) held = held.times(t.splitTo).div(t.splitFrom);
        break;
      case 'dividend':
      case 'interest':
        income += amount;
        flows.push({ date: t.date, amount });
        break;
      case 'fee':
        cost = cost.plus(amount);
        outflows += amount;
        flows.push({ date: t.date, amount: -amount });
        break;
    }
    unitsAfter.set(t.id, held);
  }

  return {
    units: held,
    cost: cost.round().toNumber(),
    realised: realised.round().toNumber(),
    income,
    outflows,
    inflows,
    lastBuyPrice,
    firstDate: sorted[0]?.date ?? null,
    unitsAfter,
    flows,
  };
}

/** Sold means no units left, or for manual and FD assets nothing left invested. */
export function isSold(h: Holding, valuation: 'units' | 'manual' | 'fd'): boolean {
  return valuation === 'units' ? h.units.lte(0) : h.cost <= 0;
}

/**
 * The money a transaction moved, which is also its linked Money row's amount: paid for
 * buys, deposits and fees (with fees); received for sells and withdrawals (after fees),
 * dividends and interest. Null for splits.
 */
export function moneyMoved(t: Pick<HoldingTxn, 'action' | 'amount' | 'fees'>): Paise | null {
  const amount = t.amount ?? 0;
  if (t.action === 'split') return null;
  if (t.action === 'buy' || t.action === 'deposit') return amount + t.fees;
  if (t.action === 'sell' || t.action === 'withdrawal') return amount - t.fees;
  return amount;
}

/** The Money row linked to an investment transaction (PLAN section 5): paid from, received in, or income. */
export function linkedMoneyRow(
  t: Pick<HoldingTxn, 'action' | 'amount' | 'fees'>,
  accountId: number,
  categoryId: number | null,
): Pick<TransactionInsert, 'type' | 'amount' | 'accountId' | 'toAccountId' | 'categoryId'> {
  const amount = moneyMoved(t) ?? 0;
  if (t.action === 'dividend' || t.action === 'interest') {
    return { type: 'income', amount, accountId, toAccountId: null, categoryId };
  }
  const paid = t.action === 'buy' || t.action === 'deposit' || t.action === 'fee';
  return paid
    ? { type: 'transfer', amount, accountId, toAccountId: null, categoryId: null }
    : { type: 'transfer', amount, accountId: null, toAccountId: accountId, categoryId: null };
}

/** Money put into investments less money taken out: buys and deposits minus sells and withdrawals. */
export function netInvested(txns: Pick<HoldingTxn, 'action' | 'amount' | 'fees'>[]): Paise {
  let net = 0;
  for (const t of txns) {
    if (t.action === 'buy' || t.action === 'deposit') net += moneyMoved(t)!;
    if (t.action === 'sell' || t.action === 'withdrawal') net -= moneyMoved(t)!;
  }
  return net;
}

/** units × price in paise, rounded. Buy and sell amounts are stored this way. */
export function unitsAmount(u: string | Decimal, price: string | Decimal): Paise {
  return new Decimal(u).times(price).times(100).round().toNumber();
}
