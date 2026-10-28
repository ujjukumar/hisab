'use client';

import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/Field/Field';
import { useActionForm } from '@/components/SettingsForms/SettingsForms';
import { saveTaxYear } from '@/lib/actions/tax';
import { formatAmount } from '@/lib/domain/format';
import { paiseToInput } from '@/lib/domain/money';
import type { TaxFigures } from '@/lib/queries/tax';
import styles from './TaxDetailsForm.module.css';

/** The figures that come from Form 16 and the owner's own records, for one year. */
export function TaxDetailsForm({
  year,
  figures: fig,
  workedInterest,
  workedDividends,
}: {
  year: number;
  figures: TaxFigures | null;
  workedInterest: number;
  workedDividends: number;
}) {
  const f = useActionForm(saveTaxYear, 'Tax details saved', { reset: false });
  const value = (p: number | null | undefined) => (p ? paiseToInput(p) : '');
  const amount = (name: string, label: string, defaultValue: string, placeholder?: string) => (
    <div>
      <TextField
        label={label}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={defaultValue}
        placeholder={placeholder}
        {...f.describe(name)}
      />
      {f.error(name)}
    </div>
  );

  return (
    <form className={styles.form} onSubmit={f.submit} noValidate aria-busy={f.pending}>
      {!fig && (
        <p className={styles.empty}>
          Add salary and TDS from your Form 16 to complete the estimate.
        </p>
      )}
      <input type="hidden" name="year" value={year} />
      <fieldset className={styles.group}>
        <legend>Salary</legend>
        {amount('grossSalary', 'Gross salary', value(fig?.grossSalary))}
        {amount('salaryTds', 'TDS on salary', value(fig?.salaryTds))}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Other income and tax paid</legend>
        {amount('otherIncome', 'Other income', value(fig?.otherIncome))}
        {amount('otherTds', 'TDS on other income', value(fig?.otherTds))}
        {amount('taxPaid', 'Advance and self-assessment tax', value(fig?.taxPaid))}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Replace a worked figure</legend>
        <p className={styles.hint}>Leave blank to use what your records show.</p>
        {amount(
          'interestOverride',
          'Interest',
          fig?.interestOverride != null ? paiseToInput(fig.interestOverride) : '',
          formatAmount(workedInterest),
        )}
        {amount(
          'dividendOverride',
          'Dividends',
          fig?.dividendOverride != null ? paiseToInput(fig.dividendOverride) : '',
          formatAmount(workedDividends),
        )}
      </fieldset>
      {f.summary}
      <Button type="submit" disabled={f.pending}>
        {f.pending ? 'Saving…' : 'Save tax details'}
      </Button>
    </form>
  );
}
