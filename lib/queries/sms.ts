import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { smsDevices, smsMessages, smsRules } from '@/lib/db/schema';
import { decryptSmsBody, ENCRYPTION_KEY_REQUIRED, SMS_DECRYPTION_FAILED } from '@/lib/sms/security';

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
      senderPattern: smsMessages.senderPattern,
      templateFingerprint: smsMessages.templateFingerprint,
      reason: smsMessages.reason,
      rawCiphertext: smsMessages.rawCiphertext,
    })
    .from(smsMessages)
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

export function smsRuleRows() {
  return db.select().from(smsRules).orderBy(smsRules.name).all();
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
export function smsDeviceRows() {
  return db
    .select(deviceColumns)
    .from(smsDevices)
    .where(isNotNull(smsDevices.approvedAt))
    .orderBy(desc(smsDevices.createdAt))
    .all();
}
