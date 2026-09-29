import { cell, csvResponse, rupees } from '@/lib/csv';
import { ASSET_TYPE_LABELS, GROUPS } from '@/lib/domain/assets';
import { periodTotals } from '@/lib/domain/performance';
import { periodPerformance } from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

const pct = (rate: number | null) => (rate === null ? '' : (rate * 100).toFixed(2));

/** The Performance tab's holdings (same `asof` and `period`) as a CSV file, with a total line. Amounts are rupees. */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { asOf, period, from, rows } = periodPerformance(params, await financialYearStartMonth());
  const title = (key: string) => GROUPS.find((g) => g.key === key)?.title ?? key;
  const t = periodTotals(rows, asOf);
  return csvResponse(
    `performance-${period}-${asOf}.csv`,
    'group,name,type,from,to,start_value,paid_in,current_value,invested,gain,absolute_pct,xirr_pct',
    [
      ...rows.map((r) =>
        [
          cell(title(r.row.group)),
          cell(r.row.asset.name),
          cell(ASSET_TYPE_LABELS[r.row.asset.type]),
          from ?? '',
          asOf,
          rupees(r.start),
          rupees(r.paidIn),
          rupees(r.row.value),
          rupees(r.row.sold ? 0 : r.row.holding.cost),
          rupees(r.gain),
          pct(r.absolute),
          pct(r.annual),
        ].join(','),
      ),
      [
        cell('Total'),
        '',
        '',
        from ?? '',
        asOf,
        '',
        '',
        rupees(t.value),
        rupees(t.invested),
        rupees(t.gain),
        pct(t.absolute),
        pct(t.annual),
      ].join(','),
    ],
  );
}
