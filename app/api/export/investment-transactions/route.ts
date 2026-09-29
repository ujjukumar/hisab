import { cell, csvResponse, rupees } from '@/lib/csv';
import { today } from '@/lib/domain/dates';
import { listInvestmentTxns, parseInvTxnFilters } from '@/lib/queries/investments';

/** The investment transactions matching the filter bar's URL, as a CSV file. Amounts are rupees. */
export function GET(request: Request) {
  const f = parseInvTxnFilters(Object.fromEntries(new URL(request.url).searchParams));
  const { rows } = listInvestmentTxns(f, { all: true });
  return csvResponse(
    `investment-transactions-${today()}.csv`,
    'date,investment,action,units,price,split,balance_units,amount,fees,total,account,note',
    rows.map((t) =>
      [
        t.date,
        cell(t.assetName),
        t.action,
        t.units ?? '',
        t.price ?? '',
        t.action === 'split' ? `${t.splitFrom}:${t.splitTo}` : '',
        t.balanceUnits ?? '',
        t.amount === null ? '' : rupees(t.amount),
        rupees(t.fees),
        t.total === null ? '' : rupees(t.total),
        cell(t.accountName),
        cell(t.note),
      ].join(','),
    ),
  );
}
