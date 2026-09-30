import { ButtonLink } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { BarChart } from '@/components/charts/BarChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import { Amount, DataTable, NameCell, type Column } from '@/components/DataTable/DataTable';
import { SelectField } from '@/components/Field/Field';
import { PageHead } from '@/components/PageHead/PageHead';
import {
  AddTransactionButton,
  TransactionDrawerProvider,
} from '@/components/TransactionDrawer/TransactionDrawer';
import { FilterForm } from '@/components/TransactionFilters/TransactionFilters';
import { formatDate, formatAmount, formatINR, formatINRSigned } from '@/lib/domain/format';
import { SHORT_MONTHS } from '@/lib/domain/dates';
import { listAccounts, listCategories } from '@/lib/queries/money';
import { monthTotals, yearReport, type CategoryYear } from '@/lib/queries/reports';

const short = (month: string) => SHORT_MONTHS[Number(month.slice(5)) - 1]!;

function CategoryTable({
  title,
  rows,
  months,
  empty,
}: {
  title: string;
  rows: CategoryYear[];
  months: string[];
  empty: string;
}) {
  const t = monthTotals(rows, months.length);
  const columns: Column<CategoryYear>[] = [
    {
      key: 'name',
      header: 'Category',
      align: 'l',
      cell: (r) => <NameCell name={r.name} color={r.color ? `var(--${r.color})` : undefined} />,
    },
    ...months.map((m, i) => ({
      key: m,
      header: short(m),
      sub: m.slice(0, 4),
      cell: (r: CategoryYear) => (
        <Amount tone={r.months[i] ? '' : 'muted'}>{formatAmount(r.months[i]!)}</Amount>
      ),
    })),
    { key: 'total', header: 'Total', cell: (r) => <Amount>{formatAmount(r.total)}</Amount> },
  ];
  return (
    <DataTable
      title={title}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      empty={
        <>
          <p>{empty}</p>
          <AddTransactionButton />
        </>
      }
      footer={
        rows.length > 0 && (
          <tr>
            <td className="l">Total</td>
            {t.months.map((v, i) => (
              <td key={months[i]} className="r">
                <Amount>{formatAmount(v)}</Amount>
              </td>
            ))}
            <td className="r">
              <Amount>{formatAmount(t.total)}</Amount>
            </td>
          </tr>
        )
      }
    />
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const r = await yearReport(await searchParams);
  const spent = monthTotals(r.spending, r.months.length);
  const earned = monthTotals(r.income, r.months.length);
  const saved = earned.total - spent.total;
  const query = new URLSearchParams({ year: String(r.year), basis: r.basis }).toString();
  const accounts = listAccounts().map(({ id, name, archived }) => ({ id, name, archived }));

  return (
    <TransactionDrawerProvider accounts={accounts} categories={listCategories()}>
      <PageHead
        title="Reports"
        actions={
          <ButtonLink
            variant="secondary"
            icon="download"
            download
            href={`/api/export/report?${query}`}
          >
            Export CSV
          </ButtonLink>
        }
        stats={[
          { label: `Income in ${r.label}`, value: formatINR(earned.total) },
          { label: `Spent in ${r.label}`, value: formatINR(spent.total) },
          {
            label: `Saved in ${r.label}`,
            value: formatINRSigned(saved),
            aside: earned.total
              ? `${Math.round((saved / earned.total) * 100)}% of income`
              : 'No income yet',
            asideTone: saved > 0 ? 'pos' : saved < 0 ? 'neg' : '',
          },
          {
            label: `Net invested in ${r.label}`,
            value: formatINRSigned(r.netInvested),
            aside: 'bought less sold',
          },
        ]}
      />

      <div className="wrap page-body">
        <FilterForm
          path="/reports"
          label="Choose the year"
          values={{ basis: r.basis, year: String(r.year) }}
        >
          <SelectField label="Year type" name="basis" defaultValue={r.basis}>
            <option value="fy">Financial year</option>
            <option value="cal">Calendar year</option>
          </SelectField>
          <SelectField label="Year" name="year" defaultValue={String(r.year)}>
            {r.years.map((y) => (
              <option key={y.value} value={y.value}>
                {y.label}
              </option>
            ))}
          </SelectField>
        </FilterForm>

        <div className="stack">
          <Card
            title="Monthly income vs spending"
            sub={`${formatDate(r.from)} to ${formatDate(r.to)}`}
          >
            <LegendInline>
              <LegendKey color="var(--c1)">Income</LegendKey>
              <LegendKey color="var(--c3)">Spending</LegendKey>
            </LegendInline>
            <BarChart
              rows={
                earned.total || spent.total
                  ? r.months.map((m, i) => ({
                      month: short(m),
                      year: m.slice(0, 4),
                      income: earned.months[i]!,
                      spending: spent.months[i]!,
                    }))
                  : []
              }
            />
          </Card>
          <CategoryTable
            title="Spending by category"
            rows={r.spending}
            months={r.months}
            empty={`No spending in ${r.label}. Add a transaction to see it here.`}
          />
          <CategoryTable
            title="Income by category"
            rows={r.income}
            months={r.months}
            empty={`No income in ${r.label}. Add a transaction to see it here.`}
          />
        </div>

        <p className="footnote">
          All amounts in ₹. Transfers between your own accounts are left out. Net invested is money
          put into investments less money taken out during the year.
        </p>
      </div>
    </TransactionDrawerProvider>
  );
}
