'use server';

import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
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
import { smsContentHash, type SmsDirection, type SmsEnvelope } from '@/lib/domain/sms';
import { parsePositivePaise } from '@/lib/domain/money';
import { isValidDate } from '@/lib/domain/dates';
import { smsPairingInviteState } from '@/lib/queries/sms';
import { readSms, type Tx } from '@/lib/actions/smsRead';
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
import { keepForUndo, takeUndo } from '@/lib/undo';
import { failed, idSchema, optionalId, type ActionFailure } from '@/lib/validation/money';

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
  /** The transaction's account; for a transfer, the account the money left. */
  accountId: z.coerce.number().int().positive(),
  categoryId: optionalId,
  toAccountId: optionalId,
  description: z.string().trim().min(1).max(200),
  /**
   * What to add. Income or spending only counts when the SMS itself does not say, since the
   * message's own flow wins; a transfer can be chosen for any SMS.
   */
  flow: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.enum(['income', 'expense', 'transfer']).optional(),
  ),
});

const linkSchema = z.object({ id: idSchema, transactionId: idSchema });

const batchApproveSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        accountId: optionalId,
        categoryId: optionalId,
      }),
    )
    .min(1)
    .max(200),
  learn: z.boolean().default(false),
});

const batchIdsSchema = z.array(idSchema).min(1).max(200);

/** A rule side's select sends `category:ID`, `transfer:ID` or nothing. */
const ruleTarget = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z
    .string()
    .regex(/^(category|transfer):[1-9]\d*$/)
    .transform((value) => {
      const [kind, id] = value.split(':');
      return { kind: kind as 'category' | 'transfer', id: Number(id) };
    })
    .nullable(),
);

const ruleSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'Enter a rule name.').max(80, 'Keep this under 80 characters.'),
  accountId: z.coerce.number({ error: 'Choose an account.' }).int().positive('Choose an account.'),
  incomeTarget: ruleTarget,
  expenseTarget: ruleTarget,
});

/** Every SMS change can move the Money tab badge and the dashboard, so refresh both. */
function revalidateSms() {
  revalidatePath('/money', 'layout');
  revalidatePath('/');
}

/** Where a learned rule sends the SMS's flow: a category, or a transfer between two accounts. */
type RuleTarget =
  | { type: 'category'; accountId: number; categoryId: number }
  | { type: 'transfer'; fromAccountId: number; toAccountId: number };

/**
 * Teach or update the rule for this sender and wording, so the next matching SMS goes
 * where the owner just sent this one. Turning learning on again also switches the rule on.
 * The rule's account is always the SMS's own one: where money out left, or money in arrived.
 */
function learnRule(
  tx: Tx,
  message: {
    senderPattern: string;
    templateFingerprint: string;
    providerKey: string;
    direction: SmsDirection;
  },
  target: RuleTarget,
): number {
  const income = message.direction === 'income';
  const accountId =
    target.type === 'category'
      ? target.accountId
      : income
        ? target.toAccountId
        : target.fromAccountId;
  const categoryId = target.type === 'category' ? target.categoryId : null;
  const transferId = target.type === 'transfer' ? (income ? target.fromAccountId : target.toAccountId) : null;
  const side = income
    ? { incomeCategoryId: categoryId, incomeTransferAccountId: transferId }
    : { expenseCategoryId: categoryId, expenseTransferAccountId: transferId };
  const existing = tx
    .select()
    .from(smsRules)
    .where(
      and(
        eq(smsRules.senderPattern, message.senderPattern),
        eq(smsRules.templateFingerprint, message.templateFingerprint),
      ),
    )
    .get();
  if (existing) {
    // A transfer on the other side can't point back at the rule's own account.
    const other = income
      ? existing.expenseTransferAccountId === accountId
        ? { expenseTransferAccountId: null }
        : {}
      : existing.incomeTransferAccountId === accountId
        ? { incomeTransferAccountId: null }
        : {};
    tx.update(smsRules)
      .set({ ...side, ...other, accountId, enabled: 1, updatedAt: new Date().toISOString() })
      .where(eq(smsRules.id, existing.id))
      .run();
    return existing.id;
  }
  return tx
    .insert(smsRules)
    .values({
      name: message.providerKey,
      senderPattern: message.senderPattern,
      providerKey: message.providerKey,
      templateFingerprint: message.templateFingerprint,
      enabled: 1,
      accountId,
      incomeCategoryId: null,
      expenseCategoryId: null,
      incomeTransferAccountId: null,
      expenseTransferAccountId: null,
      ...side,
    })
    .returning({ id: smsRules.id })
    .get().id;
}

function learnable(message: typeof smsMessages.$inferSelect) {
  const { senderPattern, templateFingerprint, providerKey, direction } = message;
  return senderPattern && templateFingerprint && providerKey && direction
    ? { senderPattern, templateFingerprint, providerKey, direction }
    : null;
}

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

export type SmsPairingInviteResult =
  { ok: true; inviteId: number; link: string; expiresAt: string } | ActionFailure;

export type SmsPairingInviteStatus =
  { status: 'waiting' } | { status: 'used'; label: string } | { status: 'expired' };

/** What the review form and the bulk panel get back. `undo` restores rejected SMS. */
export type SmsDecisionResult =
  { ok: true; message: string; count?: number; undo?: string } | ActionFailure;

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
  if (result.ok) revalidateSms();
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
  if (result.ok && result.status === 'approved') revalidateSms();
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
  if (result.ok) revalidateSms();
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
  revalidateSms();
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
  const inviteId = db.transaction((tx) => {
    tx.update(smsPairingInvites)
      .set({ expiresAt: createdAt })
      .where(and(isNull(smsPairingInvites.usedAt), gt(smsPairingInvites.expiresAt, createdAt)))
      .run();
    return tx
      .insert(smsPairingInvites)
      .values({ secretHash: hashSmsToken(secret), createdAt, expiresAt })
      .returning({ id: smsPairingInvites.id })
      .get().id;
  });
  return { ok: true, inviteId, link: smsPairingLink(baseUrl, secret), expiresAt };
}

/** Polled by the pairing drawer while it is open, to show when the phone has connected. */
export async function smsPairingInviteStatus(id: unknown): Promise<SmsPairingInviteStatus> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { status: 'expired' };
  const state = smsPairingInviteState(parsed.data);
  if (state.status === 'used') revalidateSms();
  return state;
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
  if (result.ok) revalidateSms();
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

    const { importable, fields } = readSms(tx, envelope);
    const received = {
      deviceId: device.id,
      providerMessageId: envelope.messageId ?? null,
      sender: envelope.sender,
      receivedAt: envelope.receivedAt,
      contentHash,
      ...fields,
    };
    if (importable) {
      const transaction = tx
        .insert(transactions)
        .values({
          date: importable.transactionDate,
          type: importable.type,
          amount: importable.amount,
          accountId: importable.accountId,
          toAccountId: importable.toAccountId,
          categoryId: importable.categoryId,
          description: importable.description,
        })
        .returning({ id: transactions.id })
        .get();
      const message = tx
        .insert(smsMessages)
        .values({
          ...received,
          rawCiphertext: null,
          status: 'imported',
          transactionId: transaction.id,
          reason: null,
          ruleId: importable.ruleId,
          decidedBy: 'rule',
          decidedAt: new Date().toISOString(),
        })
        .returning({ id: smsMessages.id })
        .get();
      return { ok: true, status: 'imported', id: message.id };
    }

    const message = tx
      .insert(smsMessages)
      .values({ ...received, rawCiphertext: encryptSmsBody(envelope.body), status: 'pending' })
      .returning({ id: smsMessages.id })
      .get();
    return { ok: true, status: 'queued', id: message.id };
  });
}

type Decision = { ok: true; ruleId: number | null } | ActionFailure;

/**
 * Approve one pending SMS with the owner's edits, as income, spending or a transfer between
 * two of their accounts, and optionally teach a rule from it.
 */
function decideSms(formData: FormData, learn: boolean): Decision {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failed('Enter a valid date, amount, account, category and description.');
  const amount = parsePositivePaise(parsed.data.amount);
  if (!amount.ok) return failed(amount.message, 'amount');
  const input = parsed.data;
  return db.transaction((tx): Decision => {
    const message = tx.select().from(smsMessages).where(eq(smsMessages.id, input.id)).get();
    if (!message || message.status !== 'pending') return failed('That SMS is no longer pending.');
    const template = learn ? learnable(message) : null;
    if (learn && !message.direction) {
      return failed(
        'The SMS direction is unclear. Choose a category and approve it manually instead.',
      );
    }
    if (learn && !template) {
      return failed('This SMS has no learnable template. Approve it manually instead.');
    }
    const accountExists = (id: number) =>
      tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() !==
      undefined;
    if (!accountExists(input.accountId)) {
      return failed('That account no longer exists. Choose another.', 'accountId');
    }

    let entry: {
      type: 'income' | 'expense' | 'transfer';
      toAccountId: number | null;
      categoryId: number | null;
    };
    let target: RuleTarget;
    if (input.flow === 'transfer') {
      const toAccountId = input.toAccountId;
      if (!toAccountId) return failed('Choose the account the money went to.', 'toAccountId');
      if (toAccountId === input.accountId) {
        return failed('Choose two different accounts for a transfer.', 'toAccountId');
      }
      if (!accountExists(toAccountId)) {
        return failed('That account no longer exists. Choose another.', 'toAccountId');
      }
      entry = { type: 'transfer', toAccountId, categoryId: null };
      target = { type: 'transfer', fromAccountId: input.accountId, toAccountId };
    } else {
      const expected = message.direction ?? input.flow;
      const choose = !expected
        ? 'Choose a category.'
        : expected === 'income'
          ? 'Choose an income category.'
          : 'Choose a spending category.';
      if (!input.categoryId) return failed(choose, 'categoryId');
      const category = tx
        .select({ kind: categories.kind })
        .from(categories)
        .where(eq(categories.id, input.categoryId))
        .get();
      if (!category) {
        return failed('That category no longer exists. Choose another.', 'categoryId');
      }
      if (expected && category.kind !== expected) return failed(choose, 'categoryId');
      entry = { type: category.kind, toAccountId: null, categoryId: input.categoryId };
      target = { type: 'category', accountId: input.accountId, categoryId: input.categoryId };
    }

    const ruleId = template ? learnRule(tx, template, target) : null;
    const transaction = tx
      .insert(transactions)
      .values({
        date: input.date,
        type: entry.type,
        amount: amount.value,
        accountId: input.accountId,
        toAccountId: entry.toAccountId,
        categoryId: entry.categoryId,
        description: input.description,
      })
      .returning({ id: transactions.id })
      .get();
    const now = new Date().toISOString();
    tx.update(smsMessages)
      .set({
        status: 'imported',
        // A transfer leaves the SMS's own flow as the bank wrote it.
        ...(entry.type === 'transfer' ? {} : { direction: entry.type }),
        amount: amount.value,
        transactionDate: input.date,
        proposedAccountId: input.accountId,
        proposedToAccountId: entry.toAccountId,
        proposedCategoryId: entry.categoryId,
        transactionId: transaction.id,
        rawCiphertext: null,
        ...(ruleId ? { ruleId, reason: `Learned rule ${ruleId}.` } : {}),
        decidedBy: 'owner',
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(smsMessages.id, message.id))
      .run();
    return { ok: true, ruleId };
  });
}

export async function approveSms(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const result = decideSms(formData, false);
  if (!result.ok) return result;
  revalidateSms();
  return { ok: true };
}

export async function learnSmsRuleAndApprove(
  formData: FormData,
): Promise<ActionFailure | { ok: true; ruleId: number }> {
  const result = decideSms(formData, true);
  if (!result.ok) return result;
  revalidateSms();
  return { ok: true, ruleId: result.ruleId! };
}

/**
 * Reject pending SMS and erase their text. The encrypted text is held in memory for
 * a minute so Undo can put the messages back in the queue exactly as they were.
 */
function rejectMessages(ids: number[]): { ok: true; undo: string; count: number } | ActionFailure {
  const unique = [...new Set(ids)];
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const rows = tx
      .select({
        id: smsMessages.id,
        rawCiphertext: smsMessages.rawCiphertext,
        updatedAt: smsMessages.updatedAt,
      })
      .from(smsMessages)
      .where(and(inArray(smsMessages.id, unique), eq(smsMessages.status, 'pending')))
      .all();
    if (rows.length !== unique.length) {
      return failed(
        unique.length === 1
          ? 'That SMS is no longer pending.'
          : 'Some of these SMS are no longer waiting for review. Refresh and try again.',
      );
    }
    tx.update(smsMessages)
      .set({
        status: 'rejected',
        rawCiphertext: null,
        decidedBy: 'owner',
        decidedAt: now,
        updatedAt: now,
      })
      .where(inArray(smsMessages.id, unique))
      .run();
    const undo = keepForUndo(() =>
      db.transaction((tx2) => {
        for (const row of rows) {
          tx2
            .update(smsMessages)
            .set({
              status: 'pending',
              rawCiphertext: row.rawCiphertext,
              decidedBy: null,
              decidedAt: null,
              updatedAt: row.updatedAt,
            })
            .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, 'rejected')))
            .run();
        }
      }),
    );
    return { ok: true, undo, count: rows.length };
  });
}

export async function rejectSms(formData: FormData): Promise<SmsDecisionResult> {
  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return failed('That SMS is no longer pending.');
  const result = rejectMessages([id.data]);
  if (!result.ok) return result;
  revalidateSms();
  return { ok: true, message: 'SMS rejected', count: 1, undo: result.undo };
}

/** Undo a single or bulk reject within a minute. */
export async function undoSmsReject(token: unknown): Promise<SmsDecisionResult> {
  const restore = takeUndo(token);
  if (!restore) return failed('Too late to undo that. Rejected SMS cannot be restored now.');
  restore();
  revalidateSms();
  return { ok: true, message: 'SMS restored' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Approve several SMS in one go, all or nothing. The client sends the account and
 * category it showed for each; the server checks every item is still ready.
 */
export async function approveSmsBatch(input: unknown): Promise<SmsDecisionResult> {
  const parsed = batchApproveSchema.safeParse(input);
  if (!parsed.success) return failed('Choose at least one SMS to approve.');
  const { items, learn } = parsed.data;
  const result = db.transaction((tx): SmsDecisionResult => {
    const ids = [...new Set(items.map((item) => item.id))];
    const messages = new Map(
      tx
        .select()
        .from(smsMessages)
        .where(inArray(smsMessages.id, ids))
        .all()
        .map((message) => [message.id, message]),
    );
    const activeAccounts = new Set(
      tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.archived, 0))
        .all()
        .map((account) => account.id),
    );
    const activeCategories = new Map(
      tx
        .select({ id: categories.id, kind: categories.kind })
        .from(categories)
        .where(eq(categories.archived, 0))
        .all()
        .map((category) => [category.id, category.kind]),
    );

    // Check everything before writing anything, so a problem leaves the queue untouched.
    const ready = [];
    for (const id of ids) {
      const item = items.find((candidate) => candidate.id === id)!;
      const message = messages.get(id);
      if (!message || message.status !== 'pending') {
        return failed('Some of these SMS are no longer waiting for review. Refresh and try again.');
      }
      const who = `The SMS from ${message.sender} received ${message.receivedAt.slice(0, 10)}`;
      if (message.proposedToAccountId !== null) {
        return failed(`${who} looks like a transfer. Open it to finish.`);
      }
      const { direction, amount, transactionDate } = message;
      if (
        !direction ||
        amount === null ||
        amount <= 0 ||
        !transactionDate ||
        !isValidDate(transactionDate)
      ) {
        return failed(`${who} needs more details. Open it to finish.`);
      }
      if (!item.accountId || !activeAccounts.has(item.accountId)) {
        return failed(`${who} needs an account. Open it to finish.`);
      }
      if (!item.categoryId || activeCategories.get(item.categoryId) !== direction) {
        return failed(
          `${who} needs ${direction === 'income' ? 'an income' : 'a spending'} category. Open it to finish.`,
        );
      }
      ready.push({
        message,
        direction,
        amount,
        transactionDate,
        accountId: item.accountId,
        categoryId: item.categoryId,
      });
    }

    const now = new Date().toISOString();
    let learned = 0;
    for (const item of ready) {
      const template = learn ? learnable(item.message) : null;
      const ruleId = template
        ? learnRule(tx, template, {
            type: 'category',
            accountId: item.accountId,
            categoryId: item.categoryId,
          })
        : null;
      if (ruleId) learned += 1;
      const transaction = tx
        .insert(transactions)
        .values({
          date: item.transactionDate,
          type: item.direction,
          amount: item.amount,
          accountId: item.accountId,
          categoryId: item.categoryId,
          description: item.message.providerKey ?? 'SMS transaction',
        })
        .returning({ id: transactions.id })
        .get();
      tx.update(smsMessages)
        .set({
          status: 'imported',
          proposedAccountId: item.accountId,
          proposedCategoryId: item.categoryId,
          transactionId: transaction.id,
          rawCiphertext: null,
          ...(ruleId ? { ruleId, reason: `Learned rule ${ruleId}.` } : {}),
          decidedBy: 'owner',
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(smsMessages.id, item.message.id))
        .run();
    }
    const approved =
      ready.length === 1 ? 'Transaction approved' : `${ready.length} transactions approved`;
    return {
      ok: true,
      count: ready.length,
      message: learned ? `${approved} and ${plural(learned, 'rule', 'rules')} learned` : approved,
    };
  });
  if (result.ok) revalidateSms();
  return result;
}

export async function rejectSmsBatch(ids: unknown): Promise<SmsDecisionResult> {
  const parsed = batchIdsSchema.safeParse(ids);
  if (!parsed.success) return failed('Choose at least one SMS to reject.');
  const result = rejectMessages(parsed.data);
  if (!result.ok) return result;
  revalidateSms();
  return {
    ok: true,
    message: `${result.count} SMS rejected`,
    count: result.count,
    undo: result.undo,
  };
}

/**
 * Record a pending SMS as the transfer that's already in Money, typically added from the
 * other bank's SMS, so the same payment isn't counted twice. Its text is erased as on approve.
 */
export async function linkSmsToTransfer(formData: FormData): Promise<SmsDecisionResult> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed('Choose the transfer this SMS belongs to.');
  const { id, transactionId } = parsed.data;
  const result = db.transaction((tx): SmsDecisionResult => {
    const message = tx
      .select({ status: smsMessages.status })
      .from(smsMessages)
      .where(eq(smsMessages.id, id))
      .get();
    if (message?.status !== 'pending') return failed('That SMS is no longer pending.');
    const transfer = tx
      .select({
        type: transactions.type,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .get();
    if (transfer?.type !== 'transfer') {
      return failed('That transfer no longer exists. Refresh and try again.');
    }
    const now = new Date().toISOString();
    tx.update(smsMessages)
      .set({
        status: 'imported',
        transactionId,
        rawCiphertext: null,
        proposedAccountId: transfer.accountId,
        proposedToAccountId: transfer.toAccountId,
        proposedCategoryId: null,
        decidedBy: 'owner',
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(smsMessages.id, id))
      .run();
    return { ok: true, message: 'SMS linked to transfer' };
  });
  if (result.ok) revalidateSms();
  return result;
}

/* ---------- learned rules ---------- */

export async function setSmsRuleEnabled(id: unknown, enabled: unknown): Promise<SmsDecisionResult> {
  const parsedId = idSchema.safeParse(id);
  const on = z.boolean().safeParse(enabled);
  if (!parsedId.success || !on.success) return failed('That rule no longer exists.');
  const changed = db
    .update(smsRules)
    .set({ enabled: on.data ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(eq(smsRules.id, parsedId.data))
    .run();
  if (!changed.changes) return failed('That rule no longer exists.');
  revalidateSms();
  return { ok: true, message: on.data ? 'Rule turned on' : 'Rule turned off' };
}

/** Change where a rule sends its SMS. Its sender and wording stay as learned. */
export async function updateSmsRule(formData: FormData): Promise<SmsDecisionResult> {
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? '');
    return failed(
      field.endsWith('Target')
        ? 'Choose a category or an account from the list.'
        : (issue?.message ?? 'Check the rule and try again.'),
      field,
    );
  }
  const input = parsed.data;
  if (!input.incomeTarget && !input.expenseTarget) {
    return failed('Choose where money in, money out or both go.', 'expenseTarget');
  }
  const result = db.transaction((tx): SmsDecisionResult => {
    const rule = tx
      .select({ id: smsRules.id })
      .from(smsRules)
      .where(eq(smsRules.id, input.id))
      .get();
    if (!rule) return failed('That rule no longer exists.');
    const accountExists = (id: number) =>
      tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() !==
      undefined;
    if (!accountExists(input.accountId)) {
      return failed('That account no longer exists. Choose another.', 'accountId');
    }
    for (const [field, target, kind] of [
      ['incomeTarget', input.incomeTarget, 'income'],
      ['expenseTarget', input.expenseTarget, 'expense'],
    ] as const) {
      if (!target) continue;
      if (target.kind === 'transfer') {
        if (target.id === input.accountId) {
          return failed('Choose an account other than the rule’s own account.', field);
        }
        if (!accountExists(target.id)) {
          return failed('That account no longer exists. Choose another.', field);
        }
        continue;
      }
      const category = tx
        .select({ kind: categories.kind })
        .from(categories)
        .where(eq(categories.id, target.id))
        .get();
      if (category?.kind !== kind) {
        return failed(
          kind === 'income' ? 'Choose an income category.' : 'Choose a spending category.',
          field,
        );
      }
    }
    const pick = (target: typeof input.incomeTarget, kind: 'category' | 'transfer') =>
      target?.kind === kind ? target.id : null;
    tx.update(smsRules)
      .set({
        name: input.name,
        accountId: input.accountId,
        incomeCategoryId: pick(input.incomeTarget, 'category'),
        incomeTransferAccountId: pick(input.incomeTarget, 'transfer'),
        expenseCategoryId: pick(input.expenseTarget, 'category'),
        expenseTransferAccountId: pick(input.expenseTarget, 'transfer'),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(smsRules.id, rule.id))
      .run();
    return { ok: true, message: 'Rule saved' };
  });
  if (result.ok) revalidateSms();
  return result;
}

/** Delete a rule right away. Past transactions stay; Undo puts the rule and its links back. */
export async function deleteSmsRule(id: unknown): Promise<SmsDecisionResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return failed('That rule no longer exists.');
  const result = db.transaction((tx): SmsDecisionResult => {
    const rule = tx.select().from(smsRules).where(eq(smsRules.id, parsedId.data)).get();
    if (!rule) return failed('That rule was already deleted.');
    const linked = tx
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(eq(smsMessages.ruleId, rule.id))
      .all()
      .map((row) => row.id);
    // The foreign key clears rule_id on the linked messages.
    tx.delete(smsRules).where(eq(smsRules.id, rule.id)).run();
    const undo = keepForUndo(() =>
      db.transaction((tx2) => {
        tx2.insert(smsRules).values(rule).run();
        if (linked.length) {
          tx2
            .update(smsMessages)
            .set({ ruleId: rule.id })
            .where(and(inArray(smsMessages.id, linked), isNull(smsMessages.ruleId)))
            .run();
        }
      }),
    );
    return { ok: true, message: 'Rule deleted', undo };
  });
  if (result.ok) revalidateSms();
  return result;
}

export async function undoSmsRuleDelete(token: unknown): Promise<SmsDecisionResult> {
  const restore = takeUndo(token);
  if (!restore) return failed('Too late to undo that delete.');
  try {
    restore();
  } catch {
    return failed('Could not undo: the rule’s account or category was deleted in the meantime.');
  }
  revalidateSms();
  return { ok: true, message: 'Rule restored' };
}

/* ---------- phones ---------- */

export async function revokeSmsDevice(formData: FormData): Promise<ActionFailure | { ok: true }> {
  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return failed('That SMS device is invalid.');
  const result = db
    .update(smsDevices)
    .set({ revokedAt: new Date().toISOString(), tokenCiphertext: null })
    .where(and(eq(smsDevices.id, id.data), isNull(smsDevices.revokedAt)))
    .run();
  if (!result.changes) return failed('That SMS device is already revoked.');
  revalidateSms();
  return { ok: true };
}

/**
 * The review form's one submit button sends `intent`: `learn` when "Import similar SMS
 * automatically" is ticked, otherwise `approve`. Both use the same visible fields.
 */
export async function reviewSmsFormAction(
  _previous: SmsDecisionResult | null,
  formData: FormData,
): Promise<SmsDecisionResult | null> {
  const intent = z.enum(['approve', 'learn']).safeParse(formData.get('intent'));
  if (!intent.success) return failed('Choose how to review this SMS.');
  const approved = formData.get('flow') === 'transfer' ? 'Transfer approved' : 'Transaction approved';
  if (intent.data === 'learn') {
    const result = await learnSmsRuleAndApprove(formData);
    return result.ok ? { ok: true, message: `${approved} and rule learned` } : result;
  }
  const result = await approveSms(formData);
  return result.ok ? { ok: true, message: approved } : result;
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
      ? 'Phone approved'
      : intent.data === 'reject'
        ? 'Request rejected'
        : 'Phone revoked';
  return { ok: true, message };
}
