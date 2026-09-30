import { cell, csvResponse, rupees } from '@/lib/csv';
import { monthTotals, yearReport, type CategoryYear } from '@/lib/queries/reports';

/** The Reports page's category tables (same `year` and `basis`) as one CSV file. Amounts are rupees. */
export async function GET(request: Request) {
  const r = await yearReport(Object.fromEntries(new URL(request.url).searchParams));
  const lines = (type: string, rows: CategoryYear[]) => {
    const t = monthTotals(rows, r.months.length);
    return [
      ...rows.map((row) =>
        [cell(type), cell(row.name), ...row.months.map(rupees), rupees(row.total)].join(','),
      ),
      [cell(type), cell('Total'), ...t.months.map(rupees), rupees(t.total)].join(','),
    ];
  };
  return csvResponse(
    `report-${r.basis === 'fy' ? 'fy-' : ''}${r.year}.csv`,
    ['type', 'category', ...r.months, 'total'].join(','),
    [...lines('Income', r.income), ...lines('Spending', r.spending)],
  );
}
