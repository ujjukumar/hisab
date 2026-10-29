import 'server-only';
import { and, count, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { smsDevices, smsMessages, transactions, type SmsDevice } from '@/lib/db/schema';
import { smsContentHash, type SmsEnvelope } from '@/lib/domain/sms';
import { readSms, type Tx } from '@/lib/actions/smsRead';
import { encryptSmsBody, hashSmsToken, smsEncryptionConfigured } from '@/lib/sms/security';

/*
 * Protocol v2 for the phone: an authenticated status check and batch delivery.
 * Errors carry a stable `code` so the phone can tell "pair again" from "try later".
 */

export const SMS_BATCH_MAX_MESSAGES = 50;
export const SMS_BATCH_MAX_BYTES = 256 * 1024;
export const SMS_BODY_MAX_CHARS = 4096;

export const SMS_NOT_CONFIGURED =
  'Hisaab can’t store SMS yet. Set SMS_ENCRYPTION_KEY on the server and restart it.';

export type SmsV2ErrorCode =
  | 'token_missing'
  | 'token_unknown'
  | 'device_revoked'
  | 'installation_mismatch'
  | 'invalid_json'
  | 'invalid_batch'
  | 'too_large'
  | 'server_not_configured';

export type SmsV2Error = {
  ok: false;
  httpStatus: 400 | 401 | 413 | 503;
  code: SmsV2ErrorCode;
  message: string;
};

export type SmsSource = 'live' | 'missed' | 'history' | 'manual';

export type SmsBatchItemResult =
  | { messageId: string; status: 'accepted'; id: number; imported: boolean }
  | { messageId: string; status: 'duplicate'; id: number }
  | { messageId: string; status: 'rejected'; code: 'invalid' | 'too_large'; message: string };

export type SmsBatchResult = { ok: true; results: SmsBatchItemResult[] } | SmsV2Error;

export type SmsDeviceStatus =
  | {
      ok: true;
      configured: boolean;
      device: { id: number; label: string };
      serverTime: string;
      /** When Hisaab last stored a message from this phone, across re-pairs. */
      lastReceivedAt: string | null;
      /** Messages Hisaab holds from this phone, across re-pairs. */
      acceptedTotal: number;
    }
  | SmsV2Error;

export function smsV2Error(
  httpStatus: SmsV2Error['httpStatus'],
  code: SmsV2ErrorCode,
  message: string,
): SmsV2Error {
  return { ok: false, httpStatus, code, message };
}

/** The bearer token from an `Authorization` header, or '' when there isn't one. */
export function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

/** Turn a v2 error into the response body the phone reads: `{ ok, code, message }`. */
export function smsV2ErrorResponse(error: SmsV2Error): Response {
  return Response.json(
    { ok: false, code: error.code, message: error.message },
    { status: error.httpStatus },
  );
}

/** Unlike v1, a revoked or unknown token is a 401 with a code, so the phone knows to pair again. */
function authenticate(token: string): { ok: true; device: SmsDevice } | SmsV2Error {
  if (!token) return smsV2Error(401, 'token_missing', 'Pair this phone with Hisaab first.');
  const device = db
    .select()
    .from(smsDevices)
    .where(eq(smsDevices.tokenHash, hashSmsToken(token)))
    .get();
  if (!device || !device.approvedAt) {
    return smsV2Error(401, 'token_unknown', 'Hisaab doesn’t know this phone. Pair it again.');
  }
  if (device.revokedAt) {
    return smsV2Error(401, 'device_revoked', 'This phone was unpaired in Hisaab. Pair it again.');
  }
  return { ok: true, device };
}

/**
 * Every pairing of the same phone. Re-pairing creates a new device with the same
 * installation ID, so dedup and totals look across all of them.
 */
function installationDeviceIds(tx: Tx, device: SmsDevice): number[] {
  if (!device.installationId) return [device.id];
  return tx
    .select({ id: smsDevices.id })
    .from(smsDevices)
    .where(eq(smsDevices.installationId, device.installationId))
    .all()
    .map((row) => row.id);
}

function touchDevice(tx: Tx, deviceId: number) {
  tx.update(smsDevices)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(smsDevices.id, deviceId))
    .run();
}

/**
 * Store one new SMS: imported straight away when a learned rule matches, otherwise
 * queued for review with its text encrypted. Shared by v1 and v2.
 */
export function storeSms(
  tx: Tx,
  deviceId: number,
  envelope: SmsEnvelope,
  contentHash: string,
): { status: 'queued' | 'imported'; id: number } {
  const { importable, fields } = readSms(tx, envelope);
  const received = {
    deviceId,
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
    return { status: 'imported', id: message.id };
  }
  const message = tx
    .insert(smsMessages)
    .values({ ...received, rawCiphertext: encryptSmsBody(envelope.body), status: 'pending' })
    .returning({ id: smsMessages.id })
    .get();
  return { status: 'queued', id: message.id };
}

/* ---------- status ---------- */

export function smsDeviceStatus(token: string): SmsDeviceStatus {
  const auth = authenticate(token);
  if (!auth.ok) return auth;
  const { device } = auth;
  return db.transaction((tx): SmsDeviceStatus => {
    touchDevice(tx, device.id);
    const totals = tx
      .select({ total: count(), latest: max(smsMessages.createdAt) })
      .from(smsMessages)
      .where(inArray(smsMessages.deviceId, installationDeviceIds(tx, device)))
      .get();
    return {
      ok: true,
      configured: smsEncryptionConfigured(),
      device: { id: device.id, label: device.label },
      serverTime: new Date().toISOString(),
      lastReceivedAt: totals?.latest ?? null,
      acceptedTotal: totals?.total ?? 0,
    };
  });
}

/* ---------- batch ---------- */

const batchSchema = z.object({
  schemaVersion: z.literal(2),
  installationId: z.string().trim().min(1).max(200).optional(),
  // Items are checked one by one below, so one bad message doesn't fail the batch.
  messages: z
    .array(z.looseObject({ messageId: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(SMS_BATCH_MAX_MESSAGES),
});

const itemSchema = z.object({
  messageId: z.string().trim().min(1).max(200),
  sender: z.string().trim().min(1).max(120),
  receivedAt: z.string().datetime({ offset: true }),
  body: z.string().trim().min(1),
  source: z.enum(['live', 'missed', 'history', 'manual']).optional(),
});

const ITEM_FIELD_MESSAGES: Record<string, string> = {
  sender: 'The sender is missing or over 120 characters.',
  receivedAt: 'The received time must be an ISO date and time with an offset.',
  body: 'The message text is empty.',
  source: 'The source must be live, missed, history or manual.',
};

/**
 * Same phone (any of its pairings) and either the same SMS provider ID, or the same
 * sender, text and received time. Identical text at a different time is a new message.
 */
function findDuplicate(
  tx: Tx,
  deviceIds: number[],
  messageId: string,
  contentHash: string,
  receivedAt: string,
): number | null {
  const byId = tx
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(
      and(inArray(smsMessages.deviceId, deviceIds), eq(smsMessages.providerMessageId, messageId)),
    )
    .get();
  if (byId) return byId.id;
  const instant = Date.parse(receivedAt);
  const sameText = tx
    .select({ id: smsMessages.id, receivedAt: smsMessages.receivedAt })
    .from(smsMessages)
    .where(and(inArray(smsMessages.deviceId, deviceIds), eq(smsMessages.contentHash, contentHash)))
    .all();
  return sameText.find((row) => Date.parse(row.receivedAt) === instant)?.id ?? null;
}

function receiveOne(
  tx: Tx,
  deviceId: number,
  deviceIds: number[],
  raw: { messageId: string },
): SmsBatchItemResult {
  const { messageId } = raw;
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    return {
      messageId,
      status: 'rejected',
      code: 'invalid',
      message: ITEM_FIELD_MESSAGES[field] ?? 'The message is invalid.',
    };
  }
  const { sender, receivedAt, body } = parsed.data;
  if (body.length > SMS_BODY_MAX_CHARS) {
    return {
      messageId,
      status: 'rejected',
      code: 'too_large',
      message: 'The message text is over 4,096 characters.',
    };
  }
  const contentHash = smsContentHash(sender, body);
  const duplicate = findDuplicate(tx, deviceIds, messageId, contentHash, receivedAt);
  if (duplicate !== null) return { messageId, status: 'duplicate', id: duplicate };
  const stored = storeSms(
    tx,
    deviceId,
    { schemaVersion: 1, messageId, sender, receivedAt, body },
    contentHash,
  );
  return { messageId, status: 'accepted', id: stored.id, imported: stored.status === 'imported' };
}

/**
 * Store up to 50 messages in one transaction. Each message gets its own result;
 * only a bad token, a malformed batch or a server without its key fails the whole call.
 */
export function receiveSmsBatch(token: string, input: unknown): SmsBatchResult {
  const auth = authenticate(token);
  if (!auth.ok) return auth;
  const { device } = auth;
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    return smsV2Error(
      400,
      'invalid_batch',
      `Send schemaVersion 2 and 1 to ${SMS_BATCH_MAX_MESSAGES} messages, each with a messageId.`,
    );
  }
  if (parsed.data.installationId && device.installationId !== parsed.data.installationId) {
    return smsV2Error(
      401,
      'installation_mismatch',
      'This token belongs to another installation. Pair this phone again.',
    );
  }
  if (!smsEncryptionConfigured()) {
    return smsV2Error(503, 'server_not_configured', SMS_NOT_CONFIGURED);
  }
  const results = db.transaction((tx) => {
    touchDevice(tx, device.id);
    const deviceIds = installationDeviceIds(tx, device);
    return parsed.data.messages.map((raw) => receiveOne(tx, device.id, deviceIds, raw));
  });
  return { ok: true, results };
}
