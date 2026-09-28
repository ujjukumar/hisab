import { BudgetBar } from '@/components/BudgetBar/BudgetBar';
import { Button, ButtonLink, IconButton } from '@/components/Button/Button';
import { Card, MoreLink } from '@/components/Card/Card';
import { BarChart } from '@/components/charts/BarChart';
import { DonutSplit } from '@/components/charts/Donut';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import {
  Amount,
  DataTable,
  DateCell,
  DescCell,
  Filters,
  NameCell,
  type Column,
} from '@/components/DataTable/DataTable';
import { RangeField, SearchField, SelectField, TextField } from '@/components/Field/Field';
import { GainLoseTiles } from '@/components/GainLoseTiles/GainLoseTiles';
import { PageHead } from '@/components/PageHead/PageHead';
import { Rows } from '@/components/Rows/Rows';
import { SubTabs } from '@/components/SubTabs/SubTabs';
import { Tabs } from '@/components/Tabs/Tabs';
import { Interactive } from './Interactive';
import { ACCOUNT_ROWS, BARS, GAINERS, HOLDINGS, LINE, LOSERS, SPENDING, type Holding } from './samples';
import styles from './ui.module.css';

const COLUMNS: Column<Holding>[] = [
  {
    key: 'name',
    header: 'Holding',
    align: 'l',
    sortable: true,
    cell: (h) => <NameCell href={`/investments/${h.id}`} name={h.name} sub={h.ref} color="var(--accent)" />,
  },
  { key: 'units', header: 'Units', sortable: true, cell: (h) => <Amount tone="muted">{h.units}</Amount> },
  { key: 'cost', header: 'Invested', sortable: true, cell: (h) => <Amount>{h.cost}</Amount> },
  { key: 'worth', header: 'Worth', sortable: true, cell: (h) => <Amount>{h.worth}</Amount> },
  {
    key: 'gain',
    header: 'Gain',
    sub: 'since buying',
    sortable: true,
    cell: (h) => (
      <Amount tone={h.tone} sub={h.gainPercent} subTone={h.tone}>
        {h.gain}
      </Amount>
    ),
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Every shared component with invented props, shown the way the mockup shows them. */
export function Showcase() {
  return (
    <>
      <PageHead
        title="September 2026"
        actions={
          <Button icon="plus" hideLabelOnMobile>
            Add transaction
          </Button>
        }
        stats={[
          { label: 'Net worth', value: '₹25.63 Lakh', aside: '+₹4,820 today', asideTone: 'pos' },
          { label: 'Investments', value: '₹18.59 Lakh', aside: '₹17.05 Lakh invested' },
          { label: 'Spent in September', value: '₹58,810', aside: 'of ₹71,000 budget' },
          { label: 'Saved in September', value: '₹1,04,830', tone: 'pos', aside: '64% of income' },
        ]}
        tabs={
          <Tabs
            tabs={[
              { href: '/dev/ui', label: 'Building blocks' },
              { href: '/dev/ui?tab=two', label: 'Second tab' },
            ]}
            label="Showcase sections"
          />
        }
      />

      <SubTabs
        items={[
          { key: 'mf', href: '#mf', label: 'Mutual funds' },
          { key: 'stocks', href: '#stocks', label: 'Stocks and ETFs' },
          { key: 'gold', href: '#gold', label: 'Gold' },
        ]}
        current="mf"
      />

      <Section title="Cards, rows and charts">
        <div className="grid">
          <Card
            span={8}
            title="Income vs spending"
            sub="What came in and went out each month"
            footer={<MoreLink href="/money">See all transactions</MoreLink>}
          >
            <LegendInline>
              <LegendKey color="var(--c1)">Income</LegendKey>
              <LegendKey color="var(--c3)">Spending</LegendKey>
            </LegendInline>
            <BarChart rows={BARS} />
          </Card>

          <Card span={4} title="Where it went" sub="September 2026">
            <DonutSplit items={SPENDING} label="Spending by category" />
          </Card>

          <Card span={5} title="Accounts">
            <Rows rows={ACCOUNT_ROWS} />
          </Card>

          <Card span={7} title="Budgets" sub="September 2026">
            <BudgetBar name="Housing" spent={3_200_000} budget={3_200_000} />
            <BudgetBar name="Groceries" spent={1_012_000} budget={1_200_000} />
            <BudgetBar name="Dining" spent={724_000} budget={600_000} />
            <BudgetBar name="Transport" spent={242_000} budget={500_000} />
          </Card>

          <Card span={8} title="Invested vs worth" sub="Month by month">
            <LegendInline>
              <LegendKey color="var(--c1)">Invested</LegendKey>
              <LegendKey color="var(--c2)">Worth</LegendKey>
            </LegendInline>
            <LineChart points={LINE} />
          </Card>

          <Card span={4} title="Movers" sub="Since buying">
            <GainLoseTiles gainers={GAINERS} losers={LOSERS} />
          </Card>
        </div>
      </Section>

      <Section title="Filters and table">
        <Filters>
          <SearchField label="Search" name="q" className="search" placeholder="Description or note" />
          <SelectField label="Account" name="account" defaultValue="">
            <option value="">All accounts</option>
            <option value="salary">Salary account</option>
          </SelectField>
          <SelectField label="Category" name="category" defaultValue="">
            <option value="">All categories</option>
            <option value="groceries">Groceries</option>
          </SelectField>
          <TextField label="From" name="from" type="date" defaultValue="2026-09-01" />
          <RangeField
            label="Amount"
            className="range"
            from={{ name: 'min', placeholder: '0' }}
            to={{ name: 'max', placeholder: 'Any' }}
          />
        </Filters>

        <DataTable
          title="Holdings"
          actions={<IconButton icon="download" label="Export as CSV" soft />}
          columns={COLUMNS}
          rows={HOLDINGS}
          rowKey={(h) => h.id}
          sort={{ key: 'worth', dir: 'desc' }}
          sortHref={(key, dir) => `/dev/ui?sort=${key}&dir=${dir}`}
        />

        <p className="tbl-note" style={{ marginTop: 12 }}>
          Showing 3 of 13 holdings.
        </p>

        <DataTable
          title="Empty state"
          columns={[
            { key: 'date', header: 'Date', align: 'l', cell: () => <DateCell>—</DateCell> },
            { key: 'desc', header: 'Description', align: 'l', cell: () => <DescCell desc="—" /> },
          ]}
          rows={[]}
          rowKey={() => 'none'}
          narrow
          empty={
            <>
              <p>No transactions match these filters.</p>
              <ButtonLink href="/money" variant="secondary">
                Clear filters
              </ButtonLink>
            </>
          }
        />
      </Section>

      <Section title="Buttons">
        <div className={styles.row}>
          <Button icon="plus">Add transaction</Button>
          <Button variant="secondary">Cancel</Button>
          <Button disabled>Saving…</Button>
          <IconButton icon="download" label="Export as CSV" />
          <IconButton icon="refresh" label="Update prices" soft />
        </div>
      </Section>

      <Section title="Fields">
        <div className={styles.fields}>
          <TextField label="Description" name="show-desc" defaultValue="Weekend groceries" />
          <SelectField label="Category" name="show-cat" defaultValue="groceries">
            <option value="groceries">Groceries</option>
            <option value="dining">Dining</option>
          </SelectField>
          <TextField
            label="Amount"
            name="show-amount"
            defaultValue="0"
            invalid
            aria-describedby="show-amount-error"
          />
          <p className="footnote" id="show-amount-error" style={{ color: 'var(--loss)', margin: 0 }}>
            Enter an amount greater than zero.
          </p>
        </div>
      </Section>

      <Section title="Chips, segmented, drawer, menu and toast">
        <Interactive />
      </Section>

      <Section title="Colours">
        <div className={styles.swatches}>
          {['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--gain', '--loss'].map(
            (token) => (
              <div
                key={token}
                className={styles.swatch}
                style={{ background: `var(${token})` }}
                title={token}
              />
            ),
          )}
        </div>
      </Section>
    </>
  );
}
