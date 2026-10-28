import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SpecialLine, TaxComputation } from '@/lib/domain/tax';
import { formatAmount, formatINR } from '@/lib/domain/format';
import type { TaxReport } from '@/lib/queries/tax';
import styles from './TaxSum.module.css';

const SPECIAL_LABELS: Record<SpecialLine['kind'], string> = {
  equity_short: 'Short-term gains on shares and equity funds',
  equity_long: 'Long-term gains on shares and equity funds',
  other_long: 'Long-term gains on other investments',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{title}</h3>
      <dl className={styles.lines}>{children}</dl>
    </section>
  );
}

function Line({
  label,
  note,
  working,
  amount,
  total,
}: {
  label: ReactNode;
  note?: ReactNode;
  working?: ReactNode;
  amount: number;
  total?: boolean;
}) {
  return (
    <div className={`${styles.line} ${total ? styles.total : ''}`}>
      <dt className={styles.label}>
        {label}
        {note && <span className={styles.note}>{note}</span>}
      </dt>
      <dd className={styles.working}>{working}</dd>
      <dd className={styles.amount}>{formatAmount(amount)}</dd>
    </div>
  );
}

/** A band's range, 'Up to 4,00,000', '4,00,000 to 8,00,000' or 'Above 24,00,000'. */
function bandLabel(from: number, upTo: number | null): string {
  if (from === 0) return `Up to ${formatAmount(upTo ?? 0)}`;
  if (upTo === null) return `Above ${formatAmount(from)}`;
  return `${formatAmount(from)} to ${formatAmount(upTo)}`;
}

function IncomeLines({ r, c }: { r: TaxReport; c: TaxComputation | null }) {
  const s = r.salary;
  const moneyHref = (categoryId: number | null) =>
    categoryId
      ? `/money?${new URLSearchParams({ from: r.from, to: r.to, cat: String(categoryId) })}`
      : null;
  const worked = (w: TaxReport['interest'], what: string) => {
    const href = moneyHref(w.categoryId);
    if (w.used !== w.worked) return `Your figure. Records show ${formatAmount(w.worked)}.`;
    return href ? <Link href={href}>{`See ${what} in Money`}</Link> : 'From your records';
  };
  const salaryHref = moneyHref(s.categoryId);
  const takeHome = s.tds > 0 ? `${formatAmount(s.takeHome)} take-home plus TDS` : 'Take-home pay';
  const salaryNote = s.grossTyped
    ? 'Gross, from your figures'
    : salaryHref
      ? <Link href={salaryHref}>{takeHome}</Link>
      : takeHome;
  const slabGains = Math.max(r.summary.slab, 0);
  const intraday = Math.max(r.intraday, 0);
  return (
    <>
      <Line label="Salary" note={salaryNote} amount={s.gross} />
      {c && c.standardDeduction > 0 && (
        <Line label="Standard deduction" amount={-c.standardDeduction} />
      )}
      <Line label="Interest" note={worked(r.interest, 'interest')} amount={r.interest.used} />
      <Line label="Dividends" note={worked(r.dividends, 'dividends')} amount={r.dividends.used} />
      <Line label="Other income" note="From your figures" amount={r.figures?.otherIncome ?? 0} />
      <Line
        label="Intraday trading"
        note={
          r.intraday < 0
            ? `A loss of ${formatAmount(-r.intraday)}, not set off here`
            : 'Profit after charges'
        }
        amount={intraday}
      />
      <Line
        label="Gains taxed with income"
        note={
          <Link href={`/tax/gains?year=${r.year}`}>Short-term and recent debt fund sales</Link>
        }
        amount={slabGains}
      />
      {c && <Line label="Income taxed at slab rates" amount={c.slabIncome} total />}
    </>
  );
}

/** The year's tax worked as one column, every figure traceable to the line above it. */
export function TaxSum({ report: r }: { report: TaxReport }) {
  const c = r.computation;

  if (!c) {
    return (
      <div className={styles.sum}>
        <Section title="Income">
          <IncomeLines r={r} c={null} />
          {r.summary.special.map((g) => (
            <Line key={g.kind + g.rate} label={SPECIAL_LABELS[g.kind]} amount={g.gain} />
          ))}
        </Section>
        <p className={styles.missing}>
          {`Tax rules for ${r.label} aren't added yet, so the tax isn't worked out. `}
          <Link href={`/tax?year=${r.latestRulesYear}`}>
            {`See ${r.years.find((y) => y.value === r.latestRulesYear)?.label ?? 'the latest year'}`}
          </Link>
        </p>
      </div>
    );
  }

  // Bands up to the one the income reaches; always the first.
  const bands = c.bands.filter((b, i) => i === 0 || b.income > 0);
  const balance = c.balance;

  return (
    <div className={styles.sum}>
      <Section title="Income">
        <IncomeLines r={r} c={c} />
      </Section>

      <Section title="Tax at slab rates">
        {bands.map((b) => (
          <div className={`${styles.line} ${styles.band}`} key={b.from}>
            <dt className={styles.label}>{bandLabel(b.from, b.upTo)}</dt>
            <dd className={styles.working}>
              <span className={styles.meter} aria-hidden="true">
                <i
                  style={{
                    inlineSize: `${b.upTo === null ? (b.income > 0 ? 100 : 0) : Math.round((b.income / (b.upTo - b.from)) * 100)}%`,
                  }}
                />
              </span>
              {`${formatAmount(b.income)} at ${b.rate}%`}
            </dd>
            <dd className={styles.amount}>{formatAmount(b.tax)}</dd>
          </div>
        ))}
        <Line label="Tax at slab rates" amount={c.slabTax} total />
      </Section>

      {c.special.length > 0 && (
        <Section title="Tax at special rates">
          {c.special.map((g) => {
            const less = [
              g.exemption > 0 && `${formatAmount(g.exemption)} exempt`,
              g.basicUsed > 0 && `${formatAmount(g.basicUsed)} of unused basic exemption`,
            ].filter(Boolean);
            return (
              <Line
                key={g.kind + g.rate}
                label={SPECIAL_LABELS[g.kind]}
                note={
                  less.length > 0
                    ? `${formatAmount(g.gain)} gain, less ${less.join(' and ')}`
                    : `${formatAmount(g.gain)} gain`
                }
                working={`${formatAmount(g.taxable)} at ${g.rate}%`}
                amount={g.tax}
              />
            );
          })}
          <Line label="Tax at special rates" amount={c.specialTax} total />
        </Section>
      )}

      <Section title="Rebate and cess">
        <Line label="Tax before rebate" amount={c.slabTax + c.specialTax} />
        {c.rebate > 0 && (
          <Line
            label="Rebate"
            note={`Income is ${formatAmount(r.rules?.rebateLimit ?? 0)} or less`}
            amount={-c.rebate}
          />
        )}
        {c.relief > 0 && (
          <Line
            label="Marginal relief"
            note={`Tax can't be more than the income above ${formatAmount(r.rules?.rebateLimit ?? 0)}`}
            amount={-c.relief}
          />
        )}
        <Line
          label="Health and education cess"
          working={`${formatAmount(c.taxBeforeCess)} at ${r.rules?.cess ?? 0}%`}
          amount={c.cess}
        />
        <Line label={`Tax for ${r.label}`} amount={c.totalTax} total />
      </Section>

      <Section title="Paid">
        <Line
          label="TDS on salary"
          note={
            r.salary.tdsTyped
              ? 'From your figures'
              : r.salary.grossTyped
                ? 'The tax on your gross salary'
                : 'Worked from take-home pay'
          }
          amount={c.salaryTds}
        />
        <Line label="TDS on other income" note="From Form 26AS" amount={c.otherTds} />
        <Line label="Advance and self-assessment tax" amount={c.taxPaid} />
        <Line label="Paid so far" amount={c.paid} total />
      </Section>

      <p className={styles.result}>
        <span className={styles.resultLabel}>
          {balance > 0 ? 'Left to pay' : balance < 0 ? 'Refund due' : 'Nothing left to pay'}
        </span>
        <span className={styles.resultValue}>{formatINR(Math.abs(balance))}</span>
      </p>
    </div>
  );
}
