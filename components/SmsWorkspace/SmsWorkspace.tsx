'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useTransition } from 'react';
import { Button } from '@/components/Button/Button';
import {
  manageSmsDeviceFormAction,
  rejectSmsFormAction,
  reviewSmsFormAction,
} from '@/lib/actions/sms';
import { paiseToInput } from '@/lib/domain/money';
import type { pendingSmsMessage } from '@/lib/queries/sms';
import styles from './SmsWorkspace.module.css';

type Message = Pick<
  NonNullable<ReturnType<typeof pendingSmsMessage>>,
  | 'id'
  | 'direction'
  | 'amount'
  | 'transactionDate'
  | 'proposedAccountId'
  | 'proposedCategoryId'
  | 'providerKey'
  | 'senderPattern'
  | 'templateFingerprint'
>;
type AccountOption = { id: number; name: string };
type CategoryOption = { id: number; name: string; kind: 'income' | 'expense'; archived: boolean };

export function SmsRefreshButton() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={refreshing}
      onClick={() => startTransition(() => router.refresh())}
    >
      Refresh
    </Button>
  );
}

export function SmsReviewForm({
  message,
  canReview,
  accounts,
  categories,
}: {
  message: Message;
  canReview: boolean;
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const [reviewState, reviewAction, reviewing] = useActionState(reviewSmsFormAction, null);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectSmsFormAction, null);
  const matchingCategories = categories.filter(
    (category) => !category.archived && (!message.direction || category.kind === message.direction),
  );
  const blocked = !canReview || !accounts.length || !matchingCategories.length;
  const canLearn = !!(
    message.direction &&
    message.senderPattern &&
    message.templateFingerprint &&
    message.providerKey
  );
  const categoryKinds: CategoryOption['kind'][] = message.direction
    ? [message.direction]
    : ['expense', 'income'];
  const accountId = accounts.some((account) => account.id === message.proposedAccountId)
    ? String(message.proposedAccountId)
    : '';
  const categoryId = matchingCategories.some(
    (category) => category.id === message.proposedCategoryId,
  )
    ? String(message.proposedCategoryId)
    : '';

  return (
    <div className={styles.review}>
      <p className={styles.direction}>
        {message.direction === 'income'
          ? 'Money in'
          : message.direction === 'expense'
            ? 'Money out'
            : 'Flow unclear'}
        {message.amount !== null
          ? ` · Suggested ₹${paiseToInput(message.amount)}`
          : ' · Amount not found'}
      </p>
      {!message.direction && (
        <p className={styles.hint} role="status">
          The SMS does not say clearly whether money came in or went out. Check the original text,
          then choose a Spending or Income category to set the direction. This message cannot teach
          an automatic rule.
        </p>
      )}
      {!accounts.length && (
        <p className={styles.hint} role="status">
          No active account is available. <Link href="/money/accounts">Add an account</Link> before
          approving this SMS.
        </p>
      )}
      {!matchingCategories.length && (
        <p className={styles.hint} role="status">
          No{' '}
          {message.direction === 'income'
            ? 'income'
            : message.direction === 'expense'
              ? 'spending'
              : 'active'}{' '}
          category is available. <Link href="/money/categories">Add a category</Link> before
          approving this SMS.
        </p>
      )}
      <form action={reviewAction} className={styles.form}>
        <input type="hidden" name="id" value={message.id} />
        <div className={styles.fields}>
          <label className={styles.field}>
            Date
            <input name="date" type="date" defaultValue={message.transactionDate ?? ''} required />
          </label>
          <label className={styles.field}>
            Amount (₹)
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={message.amount === null ? '' : paiseToInput(message.amount)}
              required
            />
          </label>
          <label className={styles.field}>
            Account
            <select name="accountId" defaultValue={accountId} required>
              <option value="" disabled>
                Select an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Category
            <select name="categoryId" defaultValue={categoryId} required>
              <option value="" disabled>
                Select a category
              </option>
              {categoryKinds.map((kind) => (
                <optgroup key={kind} label={kind === 'expense' ? 'Spending' : 'Income'}>
                  {matchingCategories
                    .filter((category) => category.kind === kind)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={`${styles.field} ${styles.wide}`}>
            Description
            <input
              name="description"
              defaultValue={message.providerKey ?? 'SMS transaction'}
              required
            />
          </label>
        </div>
        {reviewState && (
          <p className={styles.feedback} role="alert">
            {reviewState.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" name="intent" value="approve" disabled={blocked || reviewing}>
            Approve transaction
          </Button>
          {canLearn && (
            <Button
              type="submit"
              name="intent"
              value="learn"
              variant="secondary"
              disabled={blocked || reviewing}
            >
              Learn rule and approve
            </Button>
          )}
        </div>
      </form>
      <form action={rejectAction} className={styles.reject}>
        <input type="hidden" name="id" value={message.id} />
        <Button type="submit" variant="secondary" disabled={rejecting}>
          Reject and delete
        </Button>
        {rejectState && (
          <p className={styles.feedback} role="alert">
            {rejectState.message}
          </p>
        )}
      </form>
    </div>
  );
}

export function SmsDeviceActions({ id, request = false }: { id: number; request?: boolean }) {
  const [state, action, isPending] = useActionState(manageSmsDeviceFormAction, null);

  return (
    <form action={action} className={styles.deviceActions}>
      <input type="hidden" name="id" value={id} />
      {request ? (
        <>
          <Button type="submit" name="intent" value="approve" disabled={isPending}>
            Approve device
          </Button>
          <Button
            type="submit"
            name="intent"
            value="reject"
            variant="secondary"
            disabled={isPending}
          >
            Reject device
          </Button>
        </>
      ) : (
        <Button type="submit" name="intent" value="revoke" variant="secondary" disabled={isPending}>
          Revoke device
        </Button>
      )}
      {state && (
        <p className={styles.feedback} role={state.ok ? 'status' : 'alert'}>
          {state.message}
        </p>
      )}
    </form>
  );
}
