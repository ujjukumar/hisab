import { PageHead } from '@/components/PageHead/PageHead';
import { SelectField } from '@/components/Field/Field';
import { Tabs } from '@/components/Tabs/Tabs';
import { FilterForm } from '@/components/TransactionFilters/TransactionFilters';
import { TAX_TABS } from '@/app/nav';
import { formatINR, formatShortINR } from '@/lib/domain/format';
import type { TaxReport } from '@/lib/queries/tax';

/** The head both Tax tabs share: the year's result, then the tabs carrying the year. */
export function TaxHead({ report: r }: { report: TaxReport }) {
  const c = r.computation;
  const f = r.figures;
  const paid = c?.paid ?? (f ? f.salaryTds + f.otherTds + f.taxPaid : 0);
  const query = `year=${r.year}`;
  return (
    <PageHead
      title="Tax"
      sub={`${r.label}, new regime. An estimate to check against your return, not tax advice.`}
      statsVariant="three"
      stats={[
        {
          label: `Tax for ${r.label}`,
          value: c ? formatINR(c.totalTax) : 'Not worked out',
          aside: c ? `on ${formatShortINR(c.totalIncome)} income` : 'rules not added yet',
        },
        { label: 'Paid so far', value: formatINR(paid), aside: 'TDS and tax paid' },
        c && c.balance < 0
          ? { label: 'Refund due', value: formatINR(-c.balance) }
          : { label: 'Left to pay', value: c ? formatINR(c.balance) : 'Not worked out' },
      ]}
      tabs={<Tabs tabs={TAX_TABS.map((t) => ({ ...t, query }))} label="Tax sections" />}
    />
  );
}

export function YearFilter({ report: r, path }: { report: TaxReport; path: string }) {
  return (
    <FilterForm path={path} label="Choose the year" values={{ year: String(r.year) }}>
      <SelectField label="Financial year" name="year" defaultValue={String(r.year)}>
        {r.years.map((y) => (
          <option key={y.value} value={y.value}>
            {y.label}
          </option>
        ))}
      </SelectField>
    </FilterForm>
  );
}
