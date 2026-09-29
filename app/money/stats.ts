import type { Stat } from '@/components/StatStrip/StatStrip';
import { monthLabel } from '@/lib/domain/dates';
import { formatINR } from '@/lib/domain/format';
import type { MoneyStrip } from '@/lib/queries/money';

/** The Spent and Saved figures, shared by the Money strip and the Dashboard so they always agree. */
export function spentAndSaved(s: MoneyStrip): Stat[] {
  const month = monthLabel(s.month).split(' ')[0];
  return [
    {
      label: `Spent in ${month}`,
      value: formatINR(s.spending),
      aside: !s.budget
        ? 'No budget set'
        : s.spending > s.budget
          ? `over the ${formatINR(s.budget)} budget`
          : `of ${formatINR(s.budget)} budget`,
      asideTone: s.budget && s.spending > s.budget ? 'neg' : '',
    },
    {
      label: `Saved in ${month}`,
      value: formatINR(s.saved),
      aside: s.savingsRate === null ? 'No income yet' : `${Math.round(s.savingsRate)}% of income`,
      asideTone: s.saved > 0 ? 'pos' : s.saved < 0 ? 'neg' : '',
    },
  ];
}
