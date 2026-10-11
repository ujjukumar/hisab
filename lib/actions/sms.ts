'use server';

import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  accounts,
  categories,
  smsDevices,
  smsMessages,
  smsPairingInvites,
  smsRules,
  transactions,
} from '@/lib/db/schema';
import {
  learnedProviderKey,
  learnedSenderPattern,
  parseSms,
  smsAmount,
  smsContentHash,
  smsDirection,
  smsTransactionDate,
  smsTemplateFingerprint,
  type SmsEnvelope,
} from '@/lib/domain/sms';
import { parsePositivePaise } from '@/lib/domain/money';
import {
  ENCRYPTION_KEY_REQUIRED,
  createSmsToken,
  decryptSmsText,
  encryptSmsBody,
  encryptSmsText,
  hashSmsToken,
} from '@/lib/sms/security';
import {
  SMS_PAIRING_CODE_EXPIRED,
  SMS_PAIRING_LIFETIME_MS,
  SMS_PAIRING_URL_REQUIRED,
  smsPairingLink,
  smsPairingUrl,
} from '@/lib/sms/pairing';
import { failed, type ActionFailure } from '@/lib/validation/money';

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().trim().min(1).max(200).optional(),
  sender: z.string().trim().min(1).max(120),
  receivedAt: z.string().datetime({ offset: true }),
  body: z.string().trim().min(1).max(4096),
  installationId: z.string().trim().min(1).max(200).optional(),
});

const pairSchema = z.object({
  label: z.string().trim().min(1).max(80),
  installationId: z.string().trim().min(1).max(200).optional(),
});

const redeemSchema = pairSchema.extend({
  /** 32 random bytes as base64url, exactly as the QR code carries it. */
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const reviewSchema = z.object({
  id: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().trim().min(1),
  accountId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  description: z.string().trim().min(1).max(200),
});

const learnSchema = reviewSchema;

/** Pending requests are capped so a reachable receiver cannot be filled with junk. */
const MAX_PENDING_DEVICES = 5;

export type SmsReceiveResult =
  { ok: true; status: 'queued' | 'imported' | 'duplicate'; id: number } | ActionFailure;

export type SmsPairRequestResult =
  | { ok: true; status: 'pending'; deviceId: number; code: string; claimToken: string }
  | ActionFailure;

export type SmsClaimResult =
  | { ok: true; status: 'pending' }
  | { ok: true; status: 'approved'; token: string; deviceId: number }
  | { ok: true; status: 'claimed'; deviceId: number }
  | ActionFailure;

export type SmsPairingInviteResult = { ok: true; link: string; expiresAt: string } | ActionFailure;

/** `invalid` is a malformed request; `expired` covers used, replaced, unknown and old codes. */
export type SmsRedeemResult =
  | { ok: true; status: 'approved'; token: string; deviceId: number }
  | (ActionFailure & { status: 'invalid' | 'expired' });

/** A short code the owner can compare with the phone before approving the request. */
function pairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * Step one of pairing: the phone asks to join. No secret is required, because the
 * request is useless until the owner approves it in Money -> SMS.
 */
export async function requestSmsDevicePairing(input: unknown): Promise<SmsPairRequestResult> {
  const parsed = pairSchema.safeParse(input);
  if (!parsed.success) return failed('Send a device name with the pairing request.');
  const claimToken = createSmsToken();
  const code = pairingCode();
  const result = db.transaction((tx): SmsPairRequestResult => {
    const pending = tx
      .select({ id: smsDevices.id })
      .from(smsDevices)
      .where(and(isNull(smsDevices.approvedAt), isNull(smsDevices.revokedAt)))
      .all();
    if (pending.length >= MAX_PENDING_DEVICES) {
      return failed(
        'Too many pairing requests are waiting. Approve or reject one in Money → SMS first.',
      );
    }
    const row = tx
      .insert(smsDevices)
      .values({
        label: parsed.data.label,
        installationId: parsed.data.installationId ?? null,
        claimHash: hashSmsToken(claimToken),
        code,
      })
      .returning({ id: smsDevices.id })
      .get();
    return { ok: true, status: 'pending', deviceId: row.id, code, claimToken };
  });
  if (result.ok) revalidatePath('/money/sms');
  return result;
}

/**
 * Step three of pairing: once approved, the phone exchanges its claim secret for the
 * bearer token exactly once. The stored copy is deleted as soon as it is handed over.
 */
export async function claimSmsDeviceToken(claimToken: string): Promise<SmsClaimResult> {
  if (!claimToken) return failed('Send the pairing claim token.');
  const result = db.transaction((tx): SmsClaimResult => {
    const device = tx
      .select()
      .from(smsDevices)
      .where(eq(smsDevices.claimHash, hashSmsToken(claimToken)))
      .get();
    if (!device) return failed('That pairing request no longer exists. Start pairing again.');
    if (device.revokedAt) return failed('That pairing request was rejected. Start pairing again.');
    if (!device.approvedAt) return { ok: true, status: 'pending' };
    if (!device.tokenCiphertext) return { ok: true, status: 'claimed', deviceId: device.id };
    const token = decryptSmsText(device.tokenCiphertext);
    tx.update(smsDevices)
      .set({ tokenCiphertext: null, claimedAt: new Date().toISOString() })
      .where(eq(smsDevices.id, device.id))
      .run();
    return { ok: true, status: 'approved', token, deviceId: device.id };
  });
  if (result.ok && result.status === 'approved') revalidatePath('/money/sms');
  return result;
}

/** Step two of pairing: the owner approves the waiting request and a token is issued for it. */
export async function approveSmsDevice(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return failed('That pairing request is invalid.');
  const token = createSmsToken();
  let ciphertext: string;
  try {
    ciphertext = encryptSmsText(token);
  } catch (error) {
    if (error instanceof Error && error.message === ENCRYPTION_KEY_REQUIRED) {
      return failed('Set SMS_ENCRYPTION_KEY on the server before approving a device.');
    }
    throw error;
  }
  const result = db.transaction((tx): ActionFailure | { ok: true } => {
    const device = tx.select().from(smsDevices).where(eq(smsDevices.id, id.data)).get();
    if (!device || device.revokedAt) return failed('That pairing request is no longer waiting.');
    if (device.approvedAt) return failed('That device is already approved.');
    tx.update(smsDevices)
      .set({
        tokenHash: hashSmsToken(token),
        tokenCiphertext: ciphertext,
        approvedAt: new Date().toISOString(),
      })
      .where(eq(smsDevices.id, device.id))
      .run();
    return { ok: true };
  });
  if (result.ok) revalidatePath('/money/sms');
  return result;
}

/** Reject a waiting pairing request. The phone must start again to be paired. */
export async function rejectSmsDevice(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return failed('That pairing request is invalid.');
  const changed = db
    .update(smsDevices)
    .set({ revokedAt: new Date().toISOString(), tokenCiphertext: null })
    .where(
      and(eq(smsDevices.id, id.data), isNull(smsDevices.approvedAt), isNull(smsDevices.revokedAt)),
    )
    .run();
  if (!changed.changes) return failed('That pairing request is no longer waiting.');
  revalidatePath('/money/sms');
  return { ok: true };
}

/**
 * Show a one-time QR pairing code in Money -> SMS. Only a hash of its secret is kept,
 * and a new code replaces any earlier one that has not been used yet.
 */
export async function createSmsPairingInvite(): Promise<SmsPairingInviteResult> {
  const baseUrl = smsPairingUrl();
  if (!baseUrl) return failed(SMS_PAIRING_URL_REQUIRED);
  const secret = createSmsToken();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SMS_PAIRING_LIFETIME_MS).toISOString();
  db.transaction((tx) => {
    tx.update(smsPairingInvites)
      .set({ expiresAt: createdAt })
      .where(and(isNull(smsPairingInvites.usedAt), gt(smsPairingInvites.expiresAt, createdAt)))
      .run();
    tx.insert(smsPairingInvites)
      .values({ secretHash: hashSmsToken(secret), createdAt, expiresAt })
      .run();
  });
  return { ok: true, link: smsPairingLink(baseUrl, secret), expiresAt };
}

/**
 * The phone redeems a QR pairing code once and gets its bearer token in the reply.
 * The device is approved at once; Hisaab keeps only hashes of the code and the token.
 * Earlier devices with the same installation ID are revoked.
 */
export async function redeemSmsPairingInvite(input: unknown): Promise<SmsRedeemResult> {
  const parsed = redeemSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    const failure = fields.has('secret')
      ? failed('That pairing code is not valid. Scan or paste the code shown in Hisaab.', 'secret')
      : fields.has('label')
        ? failed('Send a device name with the pairing request.', 'label')
        : fields.has('installationId')
          ? failed('Send an installation ID of 200 characters or fewer.', 'installationId')
          : failed('Send the pairing code and a device name.');
    return { ...failure, status: 'invalid' };
  }
  const token = createSmsToken();
  const now = new Date().toISOString();
  const result = db.transaction((tx): SmsRedeemResult => {
    const invite = tx
      .select({ id: smsPairingInvites.id })
      .from(smsPairingInvites)
      .where(
        and(
          eq(smsPairingInvites.secretHash, hashSmsToken(parsed.data.secret)),
          isNull(smsPairingInvites.usedAt),
          gt(smsPairingInvites.expiresAt, now),
        ),
      )
      .get();
    if (!invite) return { ...failed(SMS_PAIRING_CODE_EXPIRED), status: 'expired' };
    if (parsed.data.installationId) {
      // A phone that pairs again replaces its earlier pairing, so the old token stops working.
      tx.update(smsDevices)
        .set({ revokedAt: now })
        .where(
          and(
            eq(smsDevices.installationId, parsed.data.installationId),
            isNull(smsDevices.revokedAt),
          ),
        )
        .run();
    }
    const device = tx
      .insert(smsDevices)
      .values({
        label: parsed.data.label,
        installationId: parsed.data.installationId ?? null,
        tokenHash: hashSmsToken(token),
        approvedAt: now,
        claimedAt: now,
      })
      .returning({ id: smsDevices.id })
      .get();
    tx.update(smsPairingInvites)
      .set({ usedAt: now, deviceId: device.id })
      .where(eq(smsPairingInvites.id, invite.id))
      .run();
    return { ok: true, status: 'approved', token, deviceId: device.id };
  });
  if (result.ok) revalidatePath('/money/sms');
  return result;
}

/** Only an approved, unrevoked device may post messages. */
function matchingDevice(token: string) {
  return db
    .select()
    .from(smsDevices)
    .where(
      and(
        eq(smsDevices.tokenHash, hashSmsToken(token)),
        isNotNull(smsDevices.approvedAt),
        isNull(smsDevices.revokedAt),
      ),
    )
    .get();
}

export async function receiveSms(token: string, input: unknown): Promise<SmsReceiveResult> {
  const device = matchingDevice(token);
  if (!device) return failed('That SMS device is not paired or has been revoked.');
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) return failed('The SMS envelope is invalid.');
  const envelope = parsed.data as SmsEnvelope;
  if (envelope.installationId && device.installationId !== envelope.installationId) {
    return failed('That SMS device installation does not match the paired device.');
  }

  const contentHash = smsContentHash(envelope.sender, envelope.body);
  return db.transaction((tx): SmsReceiveResult => {
    tx.update(smsDevices)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(smsDevices.id, device.id))
      .run();

    const duplicate = tx
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.deviceId, device.id),
          envelope.messageId
            ? or(
                eq(smsMessages.providerMessageId, envelope.messageId),
                eq(smsMessages.contentHash, contentHash),
              )
            : eq(smsMessages.contentHash, contentHash),
        ),
      )
      .get();
    if (duplicate) return { ok: true, status: 'duplicate', id: duplicate.id };

    const rules = tx
      .select()
      .from(smsRules)
      .where(eq(smsRules.enabled, 1))
      .all()
      .map((rule) => ({
        id: rule.id,
        senderPattern: rule.senderPattern,
        providerKey: rule.providerKey,
        templateFingerprint: rule.templateFingerprint,
        accountId: rule.accountId,
        incomeCategoryId: rule.incomeCategoryId,
        expenseCategoryId: rule.expenseCategoryId,
        enabled: rule.enabled === 1,
      }));
    const result = parseSms(envelope, rules);
    const candidateProviderKey = learnedProviderKey(envelope.sender, envelope.body);
    const candidateSenderPattern = learnedSenderPattern(envelope.sender);
    const candidateTemplateFingerprint = smsTemplateFingerprint(envelope.body);
    const candidateDirection = smsDirection(envelope.body);
    const candidateAmount = smsAmount(envelope.body);
    const candidateTransactionDate = smsTransactionDate(envelope.body, envelope.receivedAt);
    if (result.ok) {
      const account = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, result.proposal.accountId!))
        .get();
      const category = tx
        .select()
        .from(categories)
        .where(eq(categories.id, result.proposal.categoryId!))
        .get();
      if (!account || !category || category.kind !== result.proposal.direction) {
        result.proposal.strict = false;
        result.proposal.reasons.push('The configured account or category no longer exists.');
      }
    }

    const imported =
      result.ok &&
      result.proposal.strict &&
      result.proposal.accountId !== null &&
      result.proposal.categoryId !== null;
    if (imported) {
      const transaction = tx
        .insert(transactions)
        .values({
          date: result.proposal.transactionDate,
          type: result.proposal.direction,
          amount: result.proposal.amount,
          accountId: result.proposal.accountId,
          categoryId: result.proposal.categoryId,
          description: result.proposal.description,
        })
        .returning({ id: transactions.id })
        .get();
      const message = tx
        .insert(smsMessages)
        .values({
          deviceId: device.id,
          providerMessageId: envelope.messageId ?? null,
          sender: envelope.sender,
          receivedAt: envelope.receivedAt,
          contentHash,
          rawCiphertext: null,
          status: 'imported',
          parserVersion: '1',
          providerKey: result.proposal.providerKey,
          senderPattern: candidateSenderPattern,
          templateFingerprint: candidateTemplateFingerprint,
          direction: result.proposal.direction,
          amount: result.proposal.amount,
          transactionDate: result.proposal.transactionDate,
          reference: result.proposal.reference,
          proposedAccountId: result.proposal.accountId,
          proposedCategoryId: result.proposal.categoryId,
          transactionId: transaction.id,
          reason: null,
        })
        .returning({ id: smsMessages.id })
        .get();
      return { ok: true, status: 'imported', id: message.id };
    }

    const reasons = result.ok ? result.proposal.reasons : result.reasons;
    const message = tx
      .insert(smsMessages)
      .values({
        deviceId: device.id,
        providerMessageId: envelope.messageId ?? null,
        sender: envelope.sender,
        receivedAt: envelope.receivedAt,
        contentHash,
        rawCiphertext: encryptSmsBody(envelope.body),
        status: 'pending',
        parserVersion: '1',
        providerKey: result.ok ? result.proposal.providerKey : candidateProviderKey,
        senderPattern: candidateSenderPattern,
        templateFingerprint: candidateTemplateFingerprint,
        direction: result.ok ? result.proposal.direction : candidateDirection,
        amount: result.ok ? result.proposal.amount : candidateAmount,
        transactionDate: result.ok ? result.proposal.transactionDate : candidateTransactionDate,
        reference: result.ok ? result.proposal.reference : null,
        proposedAccountId: result.ok ? result.proposal.accountId : null,
        proposedCategoryId: result.ok ? result.proposal.categoryId : null,
        reason: reasons.join(' '),
      })
      .returning({ id: smsMessages.id })
      .get();
    return { ok: true, status: 'queued', id: message.id };
  });
}

export async function approveSms(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failed('Enter a valid date, amount, account, category and description.');
  const amount = parsePositivePaise(parsed.data.amount);
  if (!amount.ok) return failed(amount.message);
  const result = db.transaction((tx): ActionFailure | { ok: true } => {
    const message = tx.select().from(smsMessages).where(eq(smsMessages.id, parsed.data.id)).get();
    if (!message || message.status !== 'pending') return failed('That SMS is no longer pending.');
    const account = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.accountId))
      .get();
    const category = tx
      .select()
      .from(categories)
      .where(eq(categories.id, parsed.data.categoryId))
      .get();
    if (!account) return failed('That account no longer exists. Choose another.');
    if (!category) return failed('That category no longer exists. Choose another.');
    const type = message.direction ?? category.kind;
    if (category.kind !== type) {
      return failed(
        type === 'income' ? 'Choose an income category.' : 'Choose a spending category.',
      );
    }

    const transaction = tx
      .insert(transactions)
      .values({
        date: parsed.data.date,
        type,
        amount: amount.value,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId,
        description: parsed.data.description,
      })
      .returning({ id: transactions.id })
      .get();
    tx.update(smsMessages)
      .set({
        status: 'imported',
        direction: type,
        amount: amount.value,
        transactionDate: parsed.data.date,
        proposedAccountId: parsed.data.accountId,
        proposedCategoryId: parsed.data.categoryId,
        transactionId: transaction.id,
        rawCiphertext: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(smsMessages.id, message.id))
      .run();
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath('/money/sms');
    revalidatePath('/money', 'layout');
    revalidatePath('/');
  }
  return result;
}

export async function learnSmsRuleAndApprove(
  formData: FormData,
): Promise<ActionFailure | { ok: true; ruleId: number }> {
  const parsed = learnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failed('Enter a valid date, amount, account, category and description.');
  const amount = parsePositivePaise(parsed.data.amount);
  if (!amount.ok) return failed(amount.message);
  const result = db.transaction((tx): ActionFailure | { ok: true; ruleId: number } => {
    const message = tx.select().from(smsMessages).where(eq(smsMessages.id, parsed.data.id)).get();
    if (!message || message.status !== 'pending') return failed('That SMS is no longer pending.');
    if (!message.senderPattern || !message.templateFingerprint || !message.providerKey) {
      return failed('This SMS has no learnable template. Approve it manually instead.');
    }
    if (!message.direction) {
      return failed(
        'The SMS direction is unclear. Choose a category and approve it manually instead.',
      );
    }
    const account = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.accountId))
      .get();
    const category = tx
      .select()
      .from(categories)
      .where(eq(categories.id, parsed.data.categoryId))
      .get();
    if (!account) return failed('That account no longer exists. Choose another.');
    if (!category || !message.direction || category.kind !== message.direction) {
      return failed(
        message.direction === 'income'
          ? 'Choose an income category.'
          : 'Choose a spending category.',
      );
    }
    const existing = tx
      .select({ id: smsRules.id })
      .from(smsRules)
      .where(
        and(
          eq(smsRules.senderPattern, message.senderPattern),
          eq(smsRules.templateFingerprint, message.templateFingerprint),
        ),
      )
      .get();
    const ruleId =
      existing?.id ??
      tx
        .insert(smsRules)
        .values({
          name: message.providerKey,
          senderPattern: message.senderPattern,
          providerKey: message.providerKey,
          templateFingerprint: message.templateFingerprint,
          enabled: 1,
          accountId: parsed.data.accountId,
          incomeCategoryId: message.direction === 'income' ? parsed.data.categoryId : null,
          expenseCategoryId: message.direction === 'expense' ? parsed.data.categoryId : null,
        })
        .returning({ id: smsRules.id })
        .get().id;
    const transaction = tx
      .insert(transactions)
      .values({
        date: parsed.data.date,
        type: message.direction,
        amount: amount.value,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId,
        description: parsed.data.description,
      })
      .returning({ id: transactions.id })
      .get();
    tx.update(smsMessages)
      .set({
        status: 'imported',
        amount: amount.value,
        transactionDate: parsed.data.date,
        proposedAccountId: parsed.data.accountId,
        proposedCategoryId: parsed.data.categoryId,
        transactionId: transaction.id,
        rawCiphertext: null,
        reason: `Learned rule ${ruleId}.`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(smsMessages.id, message.id))
      .run();
    return { ok: true, ruleId };
  });
  if (result.ok) {
    revalidatePath('/money/sms');
    revalidatePath('/money', 'layout');
    revalidatePath('/');
  }
  return result;
}

export async function rejectSms(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return failed('That SMS is no longer pending.');
  const changed = db
    .update(smsMessages)
    .set({ status: 'rejected', rawCiphertext: null, updatedAt: new Date().toISOString() })
    .where(and(eq(smsMessages.id, id.data), eq(smsMessages.status, 'pending')))
    .run();
  if (changed.changes) {
    revalidatePath('/money/sms');
    return { ok: true };
  }
  return failed('That SMS is no longer pending.');
}

export async function revokeSmsDevice(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return failed('That SMS device is invalid.');
  const result = db
    .update(smsDevices)
    .set({ revokedAt: new Date().toISOString(), tokenCiphertext: null })
    .where(and(eq(smsDevices.id, id.data), isNull(smsDevices.revokedAt)))
    .run();
  if (!result.changes) return failed('That SMS device is already revoked.');
  revalidatePath('/money/sms');
  return { ok: true };
}

/** The two review choices submit the same visible fields, not stale hidden copies. */
export async function reviewSmsFormAction(
  _previous: ActionFailure | null,
  formData: FormData,
): Promise<ActionFailure | null> {
  const intent = z.enum(['approve', 'learn']).safeParse(formData.get('intent'));
  if (!intent.success) return failed('Choose how to review this SMS.');
  const result =
    intent.data === 'learn' ? await learnSmsRuleAndApprove(formData) : await approveSms(formData);
  if (!result.ok) return result;
  redirect('/money/sms');
}

export async function rejectSmsFormAction(
  _previous: ActionFailure | null,
  formData: FormData,
): Promise<ActionFailure | null> {
  const result = await rejectSms(formData);
  if (!result.ok) return result;
  redirect('/money/sms');
}

export type SmsDeviceFormState = ActionFailure | { ok: true; message: string } | null;

export async function manageSmsDeviceFormAction(
  _previous: SmsDeviceFormState,
  formData: FormData,
): Promise<SmsDeviceFormState> {
  const intent = z.enum(['approve', 'reject', 'revoke']).safeParse(formData.get('intent'));
  if (!intent.success) return failed('Choose a device action.');
  const result =
    intent.data === 'approve'
      ? await approveSmsDevice(formData)
      : intent.data === 'reject'
        ? await rejectSmsDevice(formData)
        : await revokeSmsDevice(formData);
  if (!result.ok) return result;
  const message =
    intent.data === 'approve'
      ? 'Device approved.'
      : intent.data === 'reject'
        ? 'Device rejected.'
        : 'Device revoked.';
  return { ok: true, message };
}
