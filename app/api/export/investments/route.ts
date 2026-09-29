import { cell, csvResponse, rupees } from '@/lib/csv';
import { ASSET_TYPE_LABELS, GROUPS } from '@/lib/domain/assets';
import { today } from '@/lib/domain/dates';
import { pickHoldings, portfolio } from '@/lib/queries/investments';

/** The Overview's holdings (same `group` and `sold` filters) as a CSV file. Amounts are rupees. */
export function GET(request: Request) {
  const date = today();
  const { rows, group } = pickHoldings(
    portfolio(date),
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const title = (key: string) => GROUPS.find((g) => g.key === key)?.title ?? key;
  return csvResponse(
    `investments-${group ?? 'all'}-${date}.csv`,
    'group,name,type,account_ref,units,last_price,price_date,total_cost,current_value,total_return,sold',
    rows.map((r) =>
      [
        cell(title(r.group)),
        cell(r.asset.name),
        cell(ASSET_TYPE_LABELS[r.asset.type]),
        cell(r.asset.accountRef),
        r.asset.valuation === 'units' ? r.holding.units.toFixed() : '',
        r.price?.price ?? '',
        r.price?.date ?? '',
        rupees(r.sold ? 0 : r.holding.cost),
        rupees(r.value),
        rupees(r.totalReturn),
        r.sold ? 'yes' : 'no',
      ].join(','),
    ),
  );
}
