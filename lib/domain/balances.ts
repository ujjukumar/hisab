// Type-only imports: scripts/seed.ts runs this file under plain Node, which needs
// explicit extensions on value imports.
import type { IsoDate } from './dates';
import type { Paise } from './money';

/** The columns of a money transaction that balances and totals depend on. */
export type Flow = {
  date: IsoDate;
  type: 'income' | 'expense' | 'transfer';
  amount: Paise;
  accountId: number | null;
  toAccountId: number | null;
};

export type OpeningBalance = { id: number; openingBalance: Paise; openingDate: IsoDate };

/**
 * What the transactions did to one account between its opening date and `onDate`,
 * both inclusive: income into it − spending from it − transfers out + transfers in.
 */
export function accountMovement(account: OpeningBalance, flows: Flow[], onDate: IsoDate): Paise {
  let net = 0;
  for (const f of flows) {
    if (f.date < account.openingDate || f.date > onDate) continue;
    if (f.accountId === account.id) net += f.type === 'income' ? f.amount : -f.amount;
    if (f.type === 'transfer' && f.toAccountId === account.id) net += f.amount;
  }
  return net;
}

/** Account balance on `onDate`. Money owed on a card comes out negative. */
export function accountBalance(account: OpeningBalance, flows: Flow[], onDate: IsoDate): Paise {
  return account.openingBalance + accountMovement(account, flows, onDate);
}

export type MonthSummary = {
  income: Paise;
  spending: Paise;
  saved: Paise;
  /** saved ÷ income, as a percentage. Null when there was no income. */
  savingsRate: number | null;
  incomeCount: number;
};

/** Income, spending and savings over whatever flows are passed in. Transfers are ignored. */
export function summarise(flows: Pick<Flow, 'type' | 'amount'>[]): MonthSummary {
  let income = 0;
  let spending = 0;
  let incomeCount = 0;
  for (const f of flows) {
    if (f.type === 'income') {
      income += f.amount;
      incomeCount += 1;
    } else if (f.type === 'expense') {
      spending += f.amount;
    }
  }
  const saved = income - spending;
  return {
    income,
    spending,
    saved,
    savingsRate: income > 0 ? (saved / income) * 100 : null,
    incomeCount,
  };
}
