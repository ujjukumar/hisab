import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { SmsPairing } from '@/components/SmsPairing/SmsPairing';
import {
  SmsDeviceActions,
  SmsRefreshButton,
  SmsReviewForm,
} from '@/components/SmsWorkspace/SmsWorkspace';
import { formatINR } from '@/lib/domain/format';
import { listAccounts, listCategories } from '@/lib/queries/money';
import {
  pendingSmsDeviceRows,
  pendingSmsMessage,
  pendingSmsMessages,
  smsDeviceRows,
  smsRuleRows,
} from '@/lib/queries/sms';
import styles from './page.module.css';

const receivedDate = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export default async function SmsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string | string[] }>;
}) {
  const param = (await searchParams).message;
  const hasSelection = param !== undefined;
  const id = typeof param === 'string' ? Number(param) : NaN;
  const selected = Number.isSafeInteger(id) && id > 0 ? pendingSmsMessage(id) : null;
  const pending = pendingSmsMessages();
  const requests = pendingSmsDeviceRows();
  const devices = smsDeviceRows();
  const rules = smsRuleRows();
  const accounts = listAccounts();
  const categories = listCategories();
  const activeAccounts = accounts.filter((account) => !account.archived);

  return (
    <div className="wrap page-body stack">
      <div className={styles.intro}>
        <h2>SMS imports</h2>
        <p>
          Check messages before adding them to Money. Exact learned matches are imported
          automatically.
        </p>
      </div>
      <div className={styles.reviewLayout}>
        <Card
          title={`Needs review (${pending.length})`}
          sub="Choose a message to approve or reject."
          action={<SmsRefreshButton />}
        >
          {pending.length === 0 ? (
            <p className={styles.empty}>
              No SMS imports need review. New unmatched messages will appear here.
            </p>
          ) : (
            <ol className={styles.queue}>
              {pending.map((message) => (
                <li key={message.id}>
                  <Link
                    href={`/money/sms?message=${message.id}#sms-detail`}
                    prefetch={false}
                    aria-current={selected?.id === message.id ? 'true' : undefined}
                    className={styles.queueLink}
                  >
                    <span className={styles.queueTop}>
                      <strong>{message.sender}</strong>
                      <span>
                        {message.amount === null
                          ? 'Amount not found'
                          : formatINR(message.amount, 2)}
                      </span>
                    </span>
                    <span className={styles.queueMeta}>
                      {message.direction === 'income'
                        ? 'Money in'
                        : message.direction === 'expense'
                          ? 'Money out'
                          : 'Flow unclear'}
                      {' · '}
                      {receivedDate.format(new Date(message.receivedAt))}
                    </span>
                    <span className={styles.queueReason}>
                      {message.reason ?? 'Check the message before approving it.'}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {(pending.length > 0 || hasSelection) && (
          <div id="sms-detail" className={styles.detail}>
            <Card
              title={selected ? 'Review message' : 'Choose a message'}
              sub={
                selected
                  ? 'Check the original SMS and edit the transaction before you save it.'
                  : undefined
              }
            >
              {selected ? (
                <>
                  <div className={styles.messageMeta}>
                    <span>
                      <strong>From</strong> {selected.sender}
                    </span>
                    <span>
                      <strong>Received</strong> {receivedDate.format(new Date(selected.receivedAt))}
                    </span>
                    {selected.reference && (
                      <span>
                        <strong>Reference</strong> {selected.reference}
                      </span>
                    )}
                  </div>
                  {selected.body === null ? (
                    <p className={styles.notice} role="alert">
                      {selected.bodyError}
                    </p>
                  ) : (
                    <blockquote className={styles.original}>{selected.body}</blockquote>
                  )}
                  {selected.reason && (
                    <p className={styles.reason}>
                      <strong>Why review?</strong> {selected.reason}
                    </p>
                  )}
                  <SmsReviewForm
                    key={selected.id}
                    message={{
                      id: selected.id,
                      direction: selected.direction,
                      amount: selected.amount,
                      transactionDate: selected.transactionDate,
                      proposedAccountId: selected.proposedAccountId,
                      proposedCategoryId: selected.proposedCategoryId,
                      providerKey: selected.providerKey,
                      senderPattern: selected.senderPattern,
                      templateFingerprint: selected.templateFingerprint,
                    }}
                    canReview={selected.body !== null}
                    accounts={activeAccounts}
                    categories={categories}
                  />
                </>
              ) : hasSelection ? (
                <p className={styles.empty} role="status">
                  That SMS is no longer waiting for review.{' '}
                  <Link href="/money/sms">Back to the queue</Link>.
                </p>
              ) : (
                <p className={styles.empty}>
                  Select a message to check its original text and decide what to do.
                </p>
              )}
            </Card>
          </div>
        )}
      </div>

      <div className={styles.management}>
        <Card
          title="Pair a phone"
          sub="Show a one-time code and scan it with your phone."
          className={styles.pairCard}
        >
          <SmsPairing />
        </Card>

        <Card
          title={`Connect requests (${requests.length})`}
          sub="Compare the code with your phone before approving."
          action={<SmsRefreshButton />}
        >
          {requests.length === 0 ? (
            <p className={styles.empty}>
              No phone is waiting to connect. To add a phone, use Pair a phone.
            </p>
          ) : (
            <ul className={styles.list}>
              {requests.map((device) => (
                <li key={device.id} className={styles.listRow}>
                  <div>
                    <strong>{device.label}</strong>
                    <p className={styles.meta}>
                      Requested {receivedDate.format(new Date(device.createdAt))}
                    </p>
                    <p className={styles.code}>
                      Code <strong>{device.code}</strong>
                    </p>
                  </div>
                  <SmsDeviceActions id={device.id} request />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Paired devices"
          sub="Revoke a phone if it is lost or its token may be exposed."
        >
          {devices.length === 0 ? (
            <p className={styles.empty}>
              No Android device is paired. Pair a phone above to receive SMS imports.
            </p>
          ) : (
            <ul className={styles.list}>
              {devices.map((device) => (
                <li key={device.id} className={styles.listRow}>
                  <div>
                    <strong>{device.label}</strong>
                    <p className={styles.meta}>
                      {device.revokedAt
                        ? 'Revoked'
                        : device.lastSeenAt
                          ? `Last seen ${receivedDate.format(new Date(device.lastSeenAt))}`
                          : device.claimedAt
                            ? 'Connected, no SMS received yet'
                            : 'Approved; waiting for phone'}
                    </p>
                  </div>
                  {!device.revokedAt && <SmsDeviceActions id={device.id} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Learned rules"
          sub="Approving a message with a rule teaches Hisaab to import the same sender and structure next time."
          className={styles.rulesCard}
        >
          {rules.length === 0 ? (
            <p className={styles.empty}>
              No rules yet. Review a message and choose “Learn rule and approve” to start.
            </p>
          ) : (
            <ul className={styles.rules}>
              {rules.map((rule) => (
                <li key={rule.id}>
                  <strong>{rule.name}</strong>
                  <span>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span className={styles.meta}>Sender: {rule.senderPattern}</span>
                  <span className={styles.meta}>
                    Account:{' '}
                    {accounts.find((account) => account.id === rule.accountId)?.name ??
                      'Missing account'}
                    {rule.incomeCategoryId
                      ? ` · Money in: ${categories.find((category) => category.id === rule.incomeCategoryId)?.name ?? 'Missing category'}`
                      : ''}
                    {rule.expenseCategoryId
                      ? ` · Money out: ${categories.find((category) => category.id === rule.expenseCategoryId)?.name ?? 'Missing category'}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
