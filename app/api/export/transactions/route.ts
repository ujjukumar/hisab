import { listTransactions, parseTxnFilters } from '@/lib/queries/money';

/** Quote every text cell, and defuse anything a spreadsheet would run as a formula. */
function cell(value: string | null): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The transactions matching the filter bar's URL, as a CSV file. Amounts are signed rupees. */
export function GET(request: Request) {
  const f = parseTxnFilters(Object.fromEntries(new URL(request.url).searchParams));
  const { rows } = listTransactions(f, { all: true });
  const lines = [
    'date,type,description,note,category,account,to_account,amount',
    ...rows.map((t) => {
      const sign = t.type === 'expense' ? -1 : 1;
      return [
        t.date,
        t.type === 'expense' ? 'spending' : t.type,
        cell(t.description),
        cell(t.note),
        cell(t.type === 'transfer' ? null : t.categoryName),
        cell(t.accountName ?? 'Investments'),
        cell(t.type === 'transfer' ? (t.toAccountName ?? 'Investments') : null),
        ((sign * t.amount) / 100).toFixed(2),
      ].join(',');
    }),
  ];
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${f.from}-to-${f.to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
