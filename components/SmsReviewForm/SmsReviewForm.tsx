'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import { AmountField, FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Segmented } from '@/components/Segmented/Segmented';
import { useToast } from '@/components/Toast/Toast';
import { rejectSms, reviewSmsFormAction, undoSmsReject } from '@/lib/actions/sms';
import type { IsoDate } from '@/lib/domain/dates';
import { paiseToInput, type Paise } from '@/lib/domain/money';
import type { SmsFlow } from '@/lib/domain/smsReview';
import styles from './SmsReviewForm.module.css';

export type SmsReviewMessage = {
  id: number;
  sender: string;
  direction: SmsFlow | null;
  amount: Paise | null;
  /** The parsed date, or the day it arrived when the SMS has none. */
  date: IsoDate | null;
  providerKey: string | null;
  /** Sender, wording and flow are all known, so approving can teach a rule. */
  canLearn: boolean;
};

type AccountOption = { id: number; name: string };
type CategoryOption = { id: number; name: string; kind: SmsFlow; archived: boolean };

const FLOWS: { value: SmsFlow; label: string }[] = [
  { value: 'expense', label: 'Money out' },
  { value: 'income', label: 'Money in' },
];

/**
 * The editable transaction for one pending SMS. Approve and Reject move straight on to
 * `afterHref`, so the owner can work down the queue without going back to the list.
 */
export function SmsReviewForm({
  message,
  suggestion,
  canReview,
  accounts,
  categories,
  afterHref,
  skipHref,
  restoreHref,
}: {
  message: SmsReviewMessage;
  suggestion: { accountId: number | null; categoryId: number | null };
  /** False when the original text can't be shown; then only Reject is offered. */
  canReview: boolean;
  /** Active accounts only. */
  accounts: AccountOption[];
  categories: CategoryOption[];
  afterHref: string;
  skipHref: string | null;
  /** This message again, for Undo after a reject. */
  restoreHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [flow, setFlow] = useState<SmsFlow>(message.direction ?? 'expense');
  const choices = categories.filter((category) => !category.archived && category.kind === flow);
  const [accountId, setAccountId] = useState(() =>
    accounts.some((account) => account.id === suggestion.accountId)
      ? String(suggestion.accountId)
      : '',
  );
  const [categoryId, setCategoryId] = useState(() =>
    choices.some((category) => category.id === suggestion.categoryId)
      ? String(suggestion.categoryId)
      : '',
  );
  const [learn, setLearn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, startSaving] = useTransition();
  const [rejecting, startRejecting] = useTransition();

  const blocked = !canReview || accounts.length === 0 || choices.length === 0;
  const busy = saving || rejecting;
  const accountName = accounts.find((account) => String(account.id) === accountId)?.name;
  const categoryName = choices.find((category) => String(category.id) === categoryId)?.name;
  const kindWord = flow === 'income' ? 'income' : 'spending';

  function chooseFlow(next: SmsFlow) {
    setFlow(next);
    if (!categories.some((c) => String(c.id) === categoryId && c.kind === next)) setCategoryId('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set('intent', learn ? 'learn' : 'approve');
    startSaving(async () => {
      const result = await reviewSmsFormAction(null, data);
      if (!result) return;
      if (!result.ok) {
        setErrors(result.fieldErrors);
        setFormError(Object.keys(result.fieldErrors).length ? '' : result.message);
        const first = Object.keys(result.fieldErrors)[0];
        const field = first && form.elements.namedItem(first);
        if (field instanceof HTMLElement) field.focus();
        return;
      }
      toast(result.message);
      router.replace(afterHref, { scroll: false });
    });
  }

  function reject() {
    const data = new FormData();
    data.set('id', String(message.id));
    startRejecting(async () => {
      const result = await rejectSms(data);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      const token = result.undo;
      toast(
        result.message,
        token
          ? {
              label: 'Undo',
              onClick: async () => {
                const undone = await undoSmsReject(token);
                toast(undone.message);
                if (undone.ok) router.replace(restoreHref, { scroll: false });
              },
            }
          : undefined,
      );
      router.replace(afterHref, { scroll: false });
    });
  }

  const describe = (field: string, errorId: string) =>
    errors[field] ? { 'aria-describedby': errorId, invalid: true } : {};

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-busy={busy}
      aria-label="Transaction from this SMS"
    >
      <input type="hidden" name="id" value={message.id} />
      <fieldset className={styles.fieldset} disabled={!canReview}>
        <legend className="sr-only">Transaction details</legend>
        {message.direction ? (
          <p className={styles.flow}>
            <span className={styles.flowLabel}>Flow</span>
            {message.direction === 'income' ? 'Money in' : 'Money out'}
          </p>
        ) : (
          <div className={styles.unclear}>
            <Segmented
              items={FLOWS}
              value={flow}
              onChange={chooseFlow}
              label="Money in or out"
              name="direction"
            />
            <p className={styles.hint}>
              The SMS doesn&apos;t say whether money came in or went out. Check the original, then
              choose.
            </p>
          </div>
        )}

        <div className={styles.fields}>
          <AmountField
            label="Amount"
            name="amount"
            placeholder="0"
            defaultValue={message.amount === null ? '' : paiseToInput(message.amount)}
            required
            {...describe('amount', 'sms-e-amount')}
          />
          <TextField
            label="Date"
            name="date"
            type="date"
            defaultValue={message.date ?? ''}
            required
            {...describe('date', 'sms-e-date')}
          />
          {(errors.amount || errors.date) && (
            <div className={styles.wide}>
              {errors.amount && <FieldError id="sms-e-amount">{errors.amount}</FieldError>}
              {errors.date && <FieldError id="sms-e-date">{errors.date}</FieldError>}
            </div>
          )}
          <SelectField
            label="Account"
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            required
            {...describe('accountId', 'sms-e-account')}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Category"
            name="categoryId"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
            {...describe('categoryId', 'sms-e-category')}
          >
            <option value="" disabled>
              {flow === 'income' ? 'Choose an income category' : 'Choose a spending category'}
            </option>
            {choices.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          {(errors.accountId || errors.categoryId) && (
            <div className={styles.wide}>
              {errors.accountId && <FieldError id="sms-e-account">{errors.accountId}</FieldError>}
              {errors.categoryId && (
                <FieldError id="sms-e-category">{errors.categoryId}</FieldError>
              )}
            </div>
          )}
          <TextField
            className={styles.wide}
            label="Description"
            name="description"
            autoComplete="off"
            defaultValue={message.providerKey ?? 'SMS transaction'}
            required
            {...describe('description', 'sms-e-description')}
          />
          {errors.description && (
            <div className={styles.wide}>
              <FieldError id="sms-e-description">{errors.description}</FieldError>
            </div>
          )}
        </div>

        {accounts.length === 0 && (
          <p className={styles.hint} role="status">
            No active account is available. <Link href="/money/accounts">Add an account</Link>{' '}
            before approving this SMS.
          </p>
        )}
        {choices.length === 0 && (
          <p className={styles.hint} role="status">
            No {kindWord} category is available.{' '}
            <Link href="/money/categories">Add a category</Link> before approving this SMS.
          </p>
        )}

        {message.canLearn ? (
          <div className={styles.learn}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={learn}
                onChange={(event) => setLearn(event.target.checked)}
                aria-keyshortcuts="L"
                aria-describedby="sms-learn-note"
              />
              Import similar SMS automatically
            </label>
            <p className={styles.note} id="sms-learn-note">
              {learn
                ? accountName && categoryName
                  ? `Future SMS from ${message.sender} with this wording go to ${accountName} · ${categoryName}.`
                  : 'Choose an account and a category to see where future SMS will go.'
                : 'Hisaab will learn this sender and wording, and add matching SMS for you.'}
            </p>
          </div>
        ) : (
          <p className={styles.note}>
            {message.direction
              ? "Hisaab can't learn a rule from this SMS, because it found no merchant or fixed wording."
              : "Hisaab can't learn a rule from this SMS, because it doesn't say whether money came in or went out."}
          </p>
        )}
      </fieldset>

      {formError && <FieldError>{formError}</FieldError>}

      <div className={styles.actions}>
        <Button
          type="submit"
          name="intent"
          value={learn ? 'learn' : 'approve'}
          disabled={blocked || busy}
          aria-keyshortcuts="A"
        >
          {saving ? 'Approving…' : learn ? 'Approve and learn rule' : 'Approve transaction'}
        </Button>
        <Button variant="secondary" onClick={reject} disabled={busy} aria-keyshortcuts="R">
          {rejecting ? 'Rejecting…' : 'Reject SMS'}
        </Button>
        {skipHref && (
          <Link className={styles.skip} href={skipHref} scroll={false} aria-keyshortcuts="S">
            Skip
          </Link>
        )}
      </div>
      <p className="footnote">Original SMS text is erased once you approve or reject it.</p>
    </form>
  );
}
