import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { SmsMessage, SmsMessageEmpty } from '@/components/SmsMessage/SmsMessage';
import { PairPhoneButton } from '@/components/SmsPairing/SmsPairing';
import { SmsReviewWorkspace, type SmsQueueItem } from '@/components/SmsReview/SmsReview';
import { SmsReviewForm } from '@/components/SmsReviewForm/SmsReviewForm';
import { smsHighlights } from '@/lib/domain/sms';
import {
  formatReceived,
  formatReceivedFull,
  highlightSegments,
  istDate,
  parseQueueFilter,
  parseQueueSort,
  smsNeighbours,
  smsQueueView,
  smsReasons,
  smsReviewHref,
  smsSuggestion,
  type SmsFlow,
} from '@/lib/domain/smsReview';
import { listAccounts, listCategories } from '@/lib/queries/money';
import {
  pendingSmsMessage,
  pendingSmsMessages,
  recentSmsApprovals,
  smsDeviceRows,
} from '@/lib/queries/sms';
import styles from './page.module.css';

type Search = {
  message?: string | string[];
  filter?: string | string[];
  sort?: string | string[];
};

type Learnable = {
  direction: SmsFlow | null;
  senderPattern: string | null;
  templateFingerprint: string | null;
  providerKey: string | null;
};

/** Approving can only teach a rule when the sender, wording and flow are all known. */
const canLearn = (m: Learnable) =>
  Boolean(m.direction && m.senderPattern && m.templateFingerprint && m.providerKey);

export default async function SmsReviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const filter = parseQueueFilter(params.filter);
  const sort = parseQueueSort(params.sort);
  const asked = params.message !== undefined;
  const id = typeof params.message === 'string' ? Number(params.message) : NaN;
  const selected = Number.isSafeInteger(id) && id > 0 ? pendingSmsMessage(id) : null;
  const pending = pendingSmsMessages();

  if (pending.length === 0) {
    const paired = smsDeviceRows().some((device) => !device.revokedAt);
    return (
      <Card>
        <div className={styles.empty}>
          <h3>No SMS imports need review</h3>
          {paired ? (
            <p>
              New unmatched messages will appear here. Messages that match a rule are imported
              automatically; see them in <Link href="/money/sms/history">History</Link>.
            </p>
          ) : (
            <>
              <p>Pair your Android phone to send bank SMS to Hisaab for review.</p>
              <PairPhoneButton />
            </>
          )}
        </div>
      </Card>
    );
  }

  const now = new Date();
  const accounts = listAccounts().map(({ id, name, archived }) => ({ id, name, archived }));
  const categories = listCategories().map(({ id, name, kind, archived }) => ({
    id,
    name,
    kind,
    archived,
  }));
  const choices = { accounts, categories };
  const history = recentSmsApprovals();

  /** The proposal when it still works, else what the owner chose last time for this sender. */
  function suggestionFor(m: {
    direction: SmsFlow | null;
    senderPattern: string | null;
    proposedAccountId: number | null;
    proposedCategoryId: number | null;
  }) {
    const accountId = accounts.find((a) => a.id === m.proposedAccountId && !a.archived)?.id ?? null;
    const categoryId =
      categories.find(
        (c) =>
          c.id === m.proposedCategoryId && !c.archived && (!m.direction || c.kind === m.direction),
      )?.id ?? null;
    if (accountId && categoryId) return { accountId, categoryId };
    return smsSuggestion(history, m, choices) ?? { accountId, categoryId };
  }

  const view = smsQueueView(pending, filter, sort);
  const items: SmsQueueItem[] = view.rows.map((m) => ({
    id: m.id,
    sender: m.sender,
    received: formatReceived(m.receivedAt, now),
    direction: m.direction,
    amount: m.amount,
    transactionDate: m.transactionDate,
    description: m.providerKey ?? 'SMS transaction',
    // The row already shows the amount and the flow, so only say what else is missing.
    reason:
      smsReasons(m.reason)
        .filter((r) => r.key !== 'amount' && r.key !== 'direction')
        .map((r) => r.short)
        .join(' · ') || null,
    ...suggestionFor(m),
    canLearn: canLearn(m),
  }));

  const place = smsNeighbours(
    items.map((item) => item.id),
    selected?.id ?? null,
  );
  const hrefFor = (message: number | null) => smsReviewHref({ message, filter, sort });
  const listHref = hrefFor(null);

  return (
    <SmsReviewWorkspace
      items={items}
      total={pending.length}
      counts={view.counts}
      filter={filter}
      sort={sort}
      open={selected?.id ?? null}
      showingMessage={asked}
      accounts={accounts}
      categories={categories}
    >
      {selected ? (
        <SmsMessage
          sender={selected.sender}
          meta={[
            `Received ${formatReceivedFull(selected.receivedAt)}`,
            `via ${selected.deviceLabel}`,
            ...(selected.reference ? [`Ref ${selected.reference}`] : []),
          ]}
          position={place.index === -1 ? null : { index: place.index + 1, total: place.total }}
          prevHref={place.prev === null ? null : hrefFor(place.prev)}
          nextHref={place.next === null ? null : hrefFor(place.next)}
          backHref={listHref}
          backLabel="All SMS to review"
          segments={
            selected.body === null
              ? null
              : highlightSegments(selected.body, smsHighlights(selected.body))
          }
          bodyError={selected.bodyError}
          reason={
            smsReasons(selected.reason)
              .map((r) => r.long)
              .join(' ') || null
          }
        >
          <SmsReviewForm
            key={selected.id}
            message={{
              id: selected.id,
              sender: selected.sender,
              direction: selected.direction,
              amount: selected.amount,
              date: selected.transactionDate ?? istDate(selected.receivedAt),
              providerKey: selected.providerKey,
              canLearn: canLearn(selected),
            }}
            suggestion={suggestionFor(selected)}
            canReview={selected.body !== null}
            accounts={accounts.filter((a) => !a.archived).map(({ id, name }) => ({ id, name }))}
            categories={categories}
            afterHref={hrefFor(place.after)}
            skipHref={
              place.skip === null || place.skip === selected.id ? null : hrefFor(place.skip)
            }
            restoreHref={hrefFor(selected.id)}
          />
        </SmsMessage>
      ) : asked ? (
        <SmsMessageEmpty>
          <p role="status">That SMS is no longer waiting for review.</p>
          <Link href={listHref} scroll={false}>
            Back to the SMS to review
          </Link>
        </SmsMessageEmpty>
      ) : (
        <SmsMessageEmpty>
          <p>Choose an SMS to check its original text, then approve or reject it.</p>
          <p className="muted">Tick several to approve or reject them together.</p>
        </SmsMessageEmpty>
      )}
    </SmsReviewWorkspace>
  );
}
