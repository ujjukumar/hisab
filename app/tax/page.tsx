import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { TaxDetailsForm } from '@/components/TaxDetailsForm/TaxDetailsForm';
import { TaxSum } from '@/components/TaxSum/TaxSum';
import { formatINR } from '@/lib/domain/format';
import { taxReport } from '@/lib/queries/tax';
import { TaxHead, YearFilter } from './TaxHead';
import styles from './page.module.css';

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const r = taxReport(await searchParams);
  const c = r.computation;
  const left = r.summary.leftOut.length;
  const lossLeft = r.summary.shortLossLeft + r.summary.longLossLeft;
  const checks = [
    ...r.problems,
    left > 0 &&
      `${left === 1 ? "One sale isn't" : `${left} sales aren't`} in the estimate: shares bought before Feb 2018 need their 31 Jan 2018 value, and long-term sales before 23 Jul 2024 may use indexation. Check them under Capital gains.`,
    lossLeft > 0 &&
      `${formatINR(lossLeft)} of capital losses isn't used this year. File on time to carry it forward.`,
    c?.surcharge &&
      'Your income is above ₹50,00,000, so a surcharge applies. This estimate leaves it out.',
  ].filter((x): x is string => typeof x === 'string');

  return (
    <>
      <TaxHead report={r} />
      <div className="wrap page-body">
        <YearFilter report={r} path="/tax" />
        <div className="grid">
          <Card span={8} title="How the tax is worked out" sub="All amounts in ₹.">
            <div className={styles.body}>
              <TaxSum report={r} />
            </div>
          </Card>
          <div className={`s4 ${styles.side}`}>
            {checks.length > 0 && (
              <Card title="Check before filing">
                <ul className={styles.checks}>
                  {checks.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                {left > 0 && (
                  <p className={styles.more}>
                    <Link href={`/tax/gains?year=${r.year}`}>See the sales</Link>
                  </p>
                )}
              </Card>
            )}
            <Card title="Your figures" sub={`For ${r.label}, from Form 16 and your own records.`}>
              <div className={styles.body}>
                <TaxDetailsForm
                  key={r.year}
                  year={r.year}
                  figures={r.figures}
                  workedInterest={r.interest.worked}
                  workedDividends={r.dividends.worked}
                />
              </div>
            </Card>
          </div>
        </div>
        <p className="footnote">
          New regime only, with the standard deduction and no other deductions. Surcharge,
          carried-forward losses and gains needing indexation or 2018 values are left out.
        </p>
      </div>
    </>
  );
}
