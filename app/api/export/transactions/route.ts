import { cell, csvResponse, rupees } from '@/lib/csv';
import { listTransactions, parseTxnFilters } from '@/lib/queries/money';

/** The transactions matching the filter bar's URL, as a CSV file. Amounts are signed rupees. */
export function GET(request: Request) {
  const f = parseTxnFilters(Object.fromEntries(new URL(request.url).searchParams));
  const { rows } = listTransactions(f, { all: true });
  return csvResponse(
    `transactions-${f.from}-to-${f.to}.csv`,
    'date,type,description,note,category,account,to_account,amount',
    rows.map((t) =>
      [
        t.date,
        t.type === 'expense' ? 'spending' : t.type,
        cell(t.description),
        cell(t.note),
        cell(t.type === 'transfer' ? null : t.categoryName),
        cell(t.accountName ?? 'Investments'),
        cell(t.type === 'transfer' ? (t.toAccountName ?? 'Investments') : null),
        rupees(t.type === 'expense' ? -t.amount : t.amount),
      ].join(','),
    ),
  );
}
