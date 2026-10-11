import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/lib/db/client';
import {
  accounts,
  smsDevices,
  smsMessages,
  smsPairingInvites,
  smsRules,
  transactions,
} from '@/lib/db/schema';
import { addDays, addMonths, type IsoDate } from '@/lib/domain/dates';
import type { Paise } from '@/lib/domain/money';
import { istDate, SMS_TRANSFER_MATCH_DAYS } from '@/lib/domain/smsReview';
import { decryptSmsBody, ENCRYPTION_KEY_REQUIRED, SMS_DECRYPTION_FAILED } from '@/lib/sms/security';

/** Messages waiting for review, for the Money tab badge and the dashboard. */
export function pendingSmsCount(): number {
  return (
    db.select({ n: count() }).from(smsMessages).where(eq(smsMessages.status, 'pending')).get()?.n ??
    0
  );
}

/** Counts for the SMS view tabs. */
export function smsTabCounts() {
  const requests =
    db
      .select({ n: count() })
      .from(smsDevices)
      .where(and(isNull(smsDevices.approvedAt), isNull(smsDevices.revokedAt)))
      .get()?.n ?? 0;
  return { pending: pendingSmsCount(), requests };
}

export function pendingSmsMessages() {
  return db
    .select({
      id: smsMessages.id,
      sender: smsMessages.sender,
      receivedAt: smsMessages.receivedAt,
      providerKey: smsMessages.providerKey,
      senderPattern: smsMessages.senderPattern,
      templateFingerprint: smsMessages.templateFingerprint,
      direction: smsMessages.direction,
      amount: smsMessages.amount,
      transactionDate: smsMessages.transactionDate,
      reference: smsMessages.reference,
      proposedAccountId: smsMessages.proposedAccountId,
      proposedCategoryId: smsMessages.proposedCategoryId,
      proposedToAccountId: smsMessages.proposedToAccountId,
      reason: smsMessages.reason,
      deviceLabel: smsDevices.label,
    })
    .from(smsMessages)
    .innerJoin(smsDevices, eq(smsDevices.id, smsMessages.deviceId))
    .where(eq(smsMessages.status, 'pending'))
    .orderBy(desc(smsMessages.receivedAt))
    .all();
}

/** Decrypt only a single, explicitly opened pending message. Queue rows stay summary-only. */
export function pendingSmsMessage(id: number) {
  const row = db
    .select({
      id: smsMessages.id,
      direction: smsMessages.direction,
      sender: smsMessages.sender,
      receivedAt: smsMessages.receivedAt,
      providerKey: smsMessages.providerKey,
      amount: smsMessages.amount,
      transactionDate: smsMessages.transactionDate,
      reference: smsMessages.reference,
      proposedAccountId: smsMessages.proposedAccountId,
      proposedCategoryId: smsMessages.proposedCategoryId,
      proposedToAccountId: smsMessages.proposedToAccountId,
      senderPattern: smsMessages.senderPattern,
      templateFingerprint: smsMessages.templateFingerprint,
      reason: smsMessages.reason,
      rawCiphertext: smsMessages.rawCiphertext,
      deviceLabel: smsDevices.label,
    })
    .from(smsMessages)
    .innerJoin(smsDevices, eq(smsDevices.id, smsMessages.deviceId))
    .where(and(eq(smsMessages.id, id), eq(smsMessages.status, 'pending')))
    .get();
  if (!row) return null;
  const { rawCiphertext, ...message } = row;
  if (!rawCiphertext) {
    return {
      ...message,
      body: null,
      bodyError: 'The original SMS is unavailable. Do not approve it without checking the message.',
    };
  }
  try {
    return { ...message, body: decryptSmsBody(rawCiphertext), bodyError: null };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === ENCRYPTION_KEY_REQUIRED ||
        error.message === 'SMS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
    ) {
      return {
        ...message,
        body: null,
        bodyError: 'Set a valid SMS_ENCRYPTION_KEY on the server to review this message.',
      };
    }
    if (error instanceof Error && error.message === SMS_DECRYPTION_FAILED) {
      return {
        ...message,
        body: null,
        bodyError:
          'The original SMS cannot be decrypted. Restore its SMS_ENCRYPTION_KEY or reject this message.',
      };
    }
    if (error instanceof Error && error.message === 'Invalid SMS ciphertext.') {
      return {
        ...message,
        body: null,
        bodyError: 'The original SMS is damaged. Restore a backup or reject this message.',
      };
    }
    throw error;
  }
}

/** What the owner chose for earlier SMS, newest first, so new ones can be prefilled the same way. */
export function recentSmsApprovals(limit = 300) {
  return db
    .select({
      senderPattern: smsMessages.senderPattern,
      direction: smsMessages.direction,
      accountId: smsMessages.proposedAccountId,
      categoryId: smsMessages.proposedCategoryId,
    })
    .from(smsMessages)
    .where(eq(smsMessages.status, 'imported'))
    .orderBy(desc(smsMessages.decidedAt), desc(smsMessages.id))
    .limit(limit)
    .all();
}

const fromAccount = alias(accounts, 'from_account');
const toAccount = alias(accounts, 'to_account');

/**
 * Transfers already in Money that an SMS may be another record of: same amount, a few days
 * either side, closest date first. Typically the other bank's SMS for the same payment.
 */
export function smsTransferMatches(amount: Paise, date: IsoDate, limit = 3) {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      fromAccountId: transactions.accountId,
      fromAccount: fromAccount.name,
      toAccountId: transactions.toAccountId,
      toAccount: toAccount.name,
    })
    .from(transactions)
    .innerJoin(fromAccount, eq(fromAccount.id, transactions.accountId))
    .innerJoin(toAccount, eq(toAccount.id, transactions.toAccountId))
    .where(
      and(
        eq(transactions.type, 'transfer'),
        eq(transactions.amount, amount),
        gte(transactions.date, addDays(date, -SMS_TRANSFER_MATCH_DAYS)),
        lte(transactions.date, addDays(date, SMS_TRANSFER_MATCH_DAYS)),
      ),
    )
    .orderBy(sql`abs(julianday(${transactions.date}) - julianday(${date}))`, desc(transactions.id))
    .limit(limit)
    .all();
}

/** Learned rules with how often each has imported an SMS and when it last did. */
export function smsRuleRows() {
  const usage = new Map(
    db
      .select({
        ruleId: smsMessages.ruleId,
        imported: count(),
        lastUsed: max(smsMessages.decidedAt),
      })
      .from(smsMessages)
      .where(and(isNotNull(smsMessages.ruleId), eq(smsMessages.status, 'imported')))
      .groupBy(smsMessages.ruleId)
      .all()
      .map((row) => [row.ruleId!, row]),
  );
  return db
    .select()
    .from(smsRules)
    .orderBy(smsRules.name, smsRules.id)
    .all()
    .map((rule) => ({
      ...rule,
      imported: usage.get(rule.id)?.imported ?? 0,
      lastUsed: usage.get(rule.id)?.lastUsed ?? null,
    }));
}

export type SmsOutcome = 'auto' | 'approved' | 'rejected';

/**
 * Decided SMS for one India-time month, or every month for one rule, newest first.
 * The original text is gone by now; this is what Hisaab keeps.
 */
export function smsHistory({ month, ruleId }: { month: string; ruleId?: number | null }) {
  const start: IsoDate = `${month}-01`;
  const rows = db
    .select({
      id: smsMessages.id,
      sender: smsMessages.sender,
      receivedAt: smsMessages.receivedAt,
      providerKey: smsMessages.providerKey,
      direction: smsMessages.direction,
      amount: smsMessages.amount,
      status: smsMessages.status,
      decidedBy: smsMessages.decidedBy,
      ruleId: smsMessages.ruleId,
      ruleName: smsRules.name,
      transactionId: smsMessages.transactionId,
      transactionType: transactions.type,
      transactionDate: transactions.date,
      description: transactions.description,
    })
    .from(smsMessages)
    .leftJoin(smsRules, eq(smsRules.id, smsMessages.ruleId))
    .leftJoin(transactions, eq(transactions.id, smsMessages.transactionId))
    .where(
      and(
        inArray(smsMessages.status, ['imported', 'rejected']),
        ruleId
          ? eq(smsMessages.ruleId, ruleId)
          : // Received times carry the phone's offset, so widen by a day and filter exactly below.
            and(
              gte(smsMessages.receivedAt, addDays(start, -1)),
              lt(smsMessages.receivedAt, addDays(`${addMonths(month, 1)}-01`, 1)),
            ),
      ),
    )
    .orderBy(desc(smsMessages.receivedAt), desc(smsMessages.id))
    .all();
  return rows
    .filter((row) => ruleId || istDate(row.receivedAt)?.slice(0, 7) === month)
    .map((row) => ({ ...row, outcome: smsOutcome(row) }));
}

function smsOutcome(row: { status: string; decidedBy: 'rule' | 'owner' | null }): SmsOutcome {
  if (row.status === 'rejected') return 'rejected';
  return row.decidedBy === 'rule' ? 'auto' : 'approved';
}

const deviceColumns = {
  id: smsDevices.id,
  label: smsDevices.label,
  installationId: smsDevices.installationId,
  code: smsDevices.code,
  createdAt: smsDevices.createdAt,
  approvedAt: smsDevices.approvedAt,
  claimedAt: smsDevices.claimedAt,
  lastSeenAt: smsDevices.lastSeenAt,
  revokedAt: smsDevices.revokedAt,
};

/** Pairing requests from a phone that are waiting for the owner to approve or reject them. */
export function pendingSmsDeviceRows() {
  return db
    .select(deviceColumns)
    .from(smsDevices)
    .where(and(isNull(smsDevices.approvedAt), isNull(smsDevices.revokedAt)))
    .orderBy(desc(smsDevices.createdAt))
    .all();
}

/** Devices the owner has already approved, including ones that were later revoked. */
export function smsDeviceRows(now: Date = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const week = new Map(
    db
      .select({ deviceId: smsMessages.deviceId, n: count() })
      .from(smsMessages)
      .where(gte(smsMessages.createdAt, weekAgo))
      .groupBy(smsMessages.deviceId)
      .all()
      .map((row) => [row.deviceId, row.n]),
  );
  return db
    .select(deviceColumns)
    .from(smsDevices)
    .where(isNotNull(smsDevices.approvedAt))
    .orderBy(desc(smsDevices.createdAt))
    .all()
    .map((device) => ({ ...device, receivedThisWeek: week.get(device.id) ?? 0 }));
}

/** Whether a QR pairing code shown in Hisaab has been used yet, and by which phone. */
export function smsPairingInviteState(
  id: number,
  now: Date = new Date(),
): { status: 'waiting' } | { status: 'used'; label: string } | { status: 'expired' } {
  const invite = db
    .select({
      usedAt: smsPairingInvites.usedAt,
      expiresAt: smsPairingInvites.expiresAt,
      label: smsDevices.label,
    })
    .from(smsPairingInvites)
    .leftJoin(smsDevices, eq(smsDevices.id, smsPairingInvites.deviceId))
    .where(eq(smsPairingInvites.id, id))
    .get();
  if (invite?.usedAt) return { status: 'used', label: invite.label ?? 'Your phone' };
  if (!invite || invite.expiresAt <= now.toISOString()) return { status: 'expired' };
  return { status: 'waiting' };
}
