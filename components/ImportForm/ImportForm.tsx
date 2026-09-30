'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import { Amount, DataTable, DateCell, NameCell } from '@/components/DataTable/DataTable';
import { FieldError, SelectField, TextField } from '@/components/Field/Field';
import { useToast } from '@/components/Toast/Toast';
import { importTransactions, previewImport } from '@/lib/actions/imports';
import {
  ACTION_LABELS,
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_TYPE_LABELS,
} from '@/lib/domain/assets';
import { formatAmount, formatDate, formatUnits } from '@/lib/domain/format';
import { moneyMoved, unitsAmount } from '@/lib/domain/holdings';
import type { ImportPlan } from '@/lib/queries/imports';
import styles from './ImportForm.module.css';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Check a Value Research file, show what it would add, then import it (PLAN section 11, phase 7). */
export function ImportForm({ accounts }: { accounts: { id: number; name: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<{ message: string; field: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);

  function check(focusSummary: boolean) {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await previewImport(data);
      if (!result.ok) {
        setPlan(null);
        setError({ message: result.message, field: 'file' in result.fieldErrors });
        form.querySelector<HTMLInputElement>('input[type=file]')?.focus();
        return;
      }
      setError(null);
      setPlan(result.plan);
      if (focusSummary) requestAnimationFrame(() => summaryRef.current?.focus());
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    check(true);
  }

  function runImport() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setImporting(true);
    startTransition(async () => {
      const result = await importTransactions(data);
      setImporting(false);
      if (!result.ok) {
        setError({ message: result.message, field: 'file' in result.fieldErrors });
        return;
      }
      toast(`${count(result.added, 'transaction')} imported`);
      router.push('/investments');
    });
  }

  const newCount = plan?.investments.filter((i) => i.assetId === null && i.toAdd > 0).length ?? 0;
  const blocked = !plan || plan.problems.length > 0 || plan.add.length === 0;
  const names = new Map(plan?.investments.map((i) => [i.isin, i.assetName ?? i.name]));

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate aria-busy={pending}>
      <div className={styles.fileRow}>
        <TextField
          label="Transaction history (.xls)"
          name="file"
          type="file"
          accept=".xls,application/vnd.ms-excel"
          onChange={() => {
            setPlan(null);
            setError(null);
          }}
          invalid={error?.field}
          aria-describedby={error?.field ? 'e-file' : undefined}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending && !importing ? 'Checking…' : 'Check file'}
        </Button>
      </div>
      {error && <FieldError id={error.field ? 'e-file' : undefined}>{error.message}</FieldError>}

      {plan && (
        <>
          <p className={styles.summary} ref={summaryRef} tabIndex={-1}>
            {[
              `${count(plan.add.length, 'transaction')} to add`,
              `${plan.duplicates} already in Hisaab`,
              count(newCount, 'new investment'),
              ...(plan.skipped.length ? [`${count(plan.skipped.length, 'row')} not imported`] : []),
            ].join(' · ')}
          </p>

          {plan.problems.length > 0 && (
            <div className={styles.problems} role="alert">
              <p>Fix these before importing:</p>
              <ul>
                {plan.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.skipped.length > 0 && (
            <details className={styles.details}>
              <summary>{count(plan.skipped.length, 'row')} not imported</summary>
              <ul>
                {plan.skipped.map((s) => (
                  <li key={`${s.sheet}-${s.line}`}>
                    {s.sheet}, row {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.investments.length > 0 && (
            <DataTable
              title={`Investments in this file (${plan.investments.length})`}
              rows={plan.investments}
              rowKey={(i) => i.isin}
              columns={[
                {
                  key: 'name',
                  header: 'Investment',
                  align: 'l',
                  cell: (i) => (
                    <NameCell name={i.name} sub={`${ASSET_TYPE_LABELS[i.type]} · ${i.isin}`} />
                  ),
                },
                { key: 'add', header: 'To add', cell: (i) => i.toAdd },
                {
                  key: 'as',
                  header: 'Add as',
                  align: 'l',
                  cell: (i) =>
                    i.fixed ? (
                      <span className={styles.linked}>{i.assetName}</span>
                    ) : (
                      <select
                        className={styles.select}
                        name={`match-${i.isin}`}
                        aria-label={`Add ${i.name} as`}
                        defaultValue={i.assetId === null ? 'new' : String(i.assetId)}
                        onChange={() => check(false)}
                      >
                        <option value="new">New investment</option>
                        {plan.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    ),
                },
                {
                  key: 'class',
                  header: 'Asset class',
                  align: 'l',
                  cell: (i) =>
                    i.assetId === null ? (
                      <select
                        className={styles.select}
                        name={`class-${i.isin}`}
                        aria-label={`Asset class for ${i.name}`}
                        defaultValue={i.assetClass}
                      >
                        {ASSET_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {ASSET_CLASS_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">Kept as it is</span>
                    ),
                },
              ]}
            />
          )}

          {plan.add.length > 0 && (
            <details className={styles.details}>
              <summary>Show the {count(plan.add.length, 'transaction')} to add</summary>
              <DataTable
                rows={plan.add}
                rowKey={(r) => r.key}
                columns={[
                  {
                    key: 'date',
                    header: 'Date',
                    align: 'l',
                    cell: (r) => <DateCell>{formatDate(r.date)}</DateCell>,
                  },
                  {
                    key: 'name',
                    header: 'Investment',
                    align: 'l',
                    cell: (r) => names.get(r.isin),
                  },
                  {
                    key: 'action',
                    header: 'Action',
                    align: 'l',
                    cell: (r) => ACTION_LABELS[r.action],
                  },
                  { key: 'units', header: 'Units', cell: (r) => formatUnits(r.units) },
                  {
                    key: 'price',
                    header: 'Price',
                    sub: 'per unit',
                    cell: (r) => (
                      <Amount sub={r.priceAdjusted ? 'from amount' : undefined}>
                        {formatAmount(unitsAmount('1', r.price), 2)}
                      </Amount>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    sub: 'with charges',
                    cell: (r) => <Amount>{formatAmount(moneyMoved(r) ?? 0, 2)}</Amount>,
                  },
                  {
                    key: 'fees',
                    header: 'Charges',
                    cell: (r) => <Amount>{formatAmount(r.fees, 2)}</Amount>,
                  },
                ]}
              />
              <p className="footnote">
                All amounts in ₹. “From amount” marks a price worked out from the amount, because
                the file&rsquo;s price didn&rsquo;t match it.
              </p>
            </details>
          )}

          {plan.add.length > 0 && (
            <div className={styles.account}>
              <SelectField label="Record in Money" name="accountId" defaultValue="">
                <option value="">Don&rsquo;t link</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </SelectField>
              <p className={styles.hint}>
                Adds a transfer out of this account for each buy and into it for each sale. Leave it
                as Don&rsquo;t link if those payments are already in Money.
              </p>
            </div>
          )}

          {plan.add.length === 0 && plan.problems.length === 0 && (
            <p>Everything in this file is already in Hisaab. Nothing to import.</p>
          )}

          <div>
            <Button onClick={runImport} disabled={blocked || pending}>
              {importing ? 'Importing…' : `Import ${count(plan.add.length, 'transaction')}`}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
