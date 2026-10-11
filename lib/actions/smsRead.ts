import 'server-only';
import { and, eq, gte, isNotNull, lte, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accounts, categories, smsMessages, smsRules, transactions } from '@/lib/db/schema';
import { addDays, type IsoDate } from '@/lib/domain/dates';
import type { Paise } from '@/lib/domain/money';
import {
  learnedProviderKey,
  learnedSenderPattern,
  parseSms,
  SMS_PARSER_VERSION,
  smsAmount,
  smsDirection,
  smsTemplateFingerprint,
  smsTransactionDate,
  type SmsEnvelope,
  type SmsProposal,
} from '@/lib/domain/sms';
import { SMS_TRANSFER_MATCH_DAYS } from '@/lib/domain/smsReview';
import { decryptSmsBody } from '@/lib/sms/security';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const STALE_RULE = 'The configured account or category no longer exists.';
const TRANSFER_RECORDED = 'A matching transfer is already recorded.';

/** A transfer already in Money between the same two accounts, for the same amount, a few days either side. */
export function matchingTransfer(
  tx: Tx,
  transfer: { accountId: number; toAccountId: number; amount: Paise; date: IsoDate },
): { id: number } | null {
  return (
    tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, 'transfer'),
          eq(transactions.accountId, transfer.accountId),
          eq(transactions.toAccountId, transfer.toAccountId),
          eq(transactions.amount, transfer.amount),
          gte(transactions.date, addDays(transfer.date, -SMS_TRANSFER_MATCH_DAYS)),
          lte(transactions.date, addDays(transfer.date, SMS_TRANSFER_MATCH_DAYS)),
        ),
      )
      .get() ?? null
  );
}

const accountExists = (tx: Tx, id: number | null) =>
  id !== null &&
  tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() !== undefined;

/** Why a rule's proposal can't be added without the owner, or null when it can. */
function problemWith(tx: Tx, proposal: SmsProposal): string | null {
  if (proposal.type === 'transfer') {
    if (
      !accountExists(tx, proposal.accountId) ||
      !accountExists(tx, proposal.toAccountId) ||
      proposal.accountId === proposal.toAccountId
    ) {
      return STALE_RULE;
    }
    // The other bank often sends its own SMS for the same payment; don't count it twice.
    const recorded = matchingTransfer(tx, {
      accountId: proposal.accountId!,
      toAccountId: proposal.toAccountId!,
      amount: proposal.amount,
      date: proposal.transactionDate,
    });
    return recorded ? TRANSFER_RECORDED : null;
  }
  const category =
    proposal.categoryId === null
      ? undefined
      : tx
          .select({ kind: categories.kind })
          .from(categories)
          .where(eq(categories.id, proposal.categoryId))
          .get();
  return accountExists(tx, proposal.accountId) && category?.kind === proposal.direction
    ? null
    : STALE_RULE;
}

/**
 * Read an SMS with the rules as they are now. `importable` is the rule's proposal when
 * it can be added without the owner; `fields` is what the message row keeps either way.
 */
export function readSms(tx: Tx, envelope: SmsEnvelope) {
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
      incomeTransferAccountId: rule.incomeTransferAccountId,
      expenseTransferAccountId: rule.expenseTransferAccountId,
      enabled: true,
    }));
  const result = parseSms(envelope, rules);
  const proposal = result.ok ? result.proposal : null;
  if (proposal) {
    const problem = problemWith(tx, proposal);
    if (problem) {
      proposal.strict = false;
      proposal.reasons.push(problem);
    }
  }
  const reasons = result.ok ? result.proposal.reasons : result.reasons;
  return {
    importable: proposal?.strict ? proposal : null,
    fields: {
      parserVersion: SMS_PARSER_VERSION,
      providerKey: proposal?.providerKey ?? learnedProviderKey(envelope.sender, envelope.body),
      senderPattern: learnedSenderPattern(envelope.sender),
      templateFingerprint: smsTemplateFingerprint(envelope.body),
      direction: proposal?.direction ?? smsDirection(envelope.body),
      amount: proposal?.amount ?? smsAmount(envelope.body),
      transactionDate:
        proposal?.transactionDate ?? smsTransactionDate(envelope.body, envelope.receivedAt),
      reference: proposal?.reference ?? null,
      proposedAccountId: proposal?.accountId ?? null,
      proposedCategoryId: proposal?.categoryId ?? null,
      proposedToAccountId: proposal?.toAccountId ?? null,
      reason: reasons.join(' '),
    },
  };
}

/**
 * Read SMS that are still waiting for review again after the parser has changed, so the
 * queue shows the newer reading. Nothing is imported here; they still wait for the owner.
 * Messages whose text can't be decrypted are left as they are.
 */
export function rereadPendingSms(): number {
  const rows = db
    .select({
      id: smsMessages.id,
      sender: smsMessages.sender,
      receivedAt: smsMessages.receivedAt,
      rawCiphertext: smsMessages.rawCiphertext,
    })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.status, 'pending'),
        ne(smsMessages.parserVersion, SMS_PARSER_VERSION),
        isNotNull(smsMessages.rawCiphertext),
      ),
    )
    .all();
  const readable = rows.flatMap((row) => {
    try {
      const body = decryptSmsBody(row.rawCiphertext!);
      return [{ id: row.id, envelope: { ...row, schemaVersion: 1 as const, body } }];
    } catch {
      return [];
    }
  });
  if (readable.length === 0) return 0;
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const { id, envelope } of readable) {
      tx.update(smsMessages)
        .set({ ...readSms(tx, envelope).fields, updatedAt: now })
        .where(and(eq(smsMessages.id, id), eq(smsMessages.status, 'pending')))
        .run();
    }
  });
  return readable.length;
}
