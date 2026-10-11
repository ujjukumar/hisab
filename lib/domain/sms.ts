import { createHash } from 'node:crypto';
import { parsePaise, type Paise } from './money';
import { isValidDate, type IsoDate } from './dates';

/** Bumped when parsing changes, so SMS still waiting for review are read again. */
export const SMS_PARSER_VERSION = '3';

export type SmsDirection = 'income' | 'expense';

export type SmsEnvelope = {
  schemaVersion: 1;
  messageId?: string;
  sender: string;
  receivedAt: string;
  body: string;
  installationId?: string;
};

export type SmsRuleInput = {
  id: number;
  senderPattern: string;
  providerKey: string;
  templateFingerprint: string | null;
  accountId: number;
  incomeCategoryId: number | null;
  expenseCategoryId: number | null;
  /** Money in that becomes a transfer from this account into `accountId`, instead of income. */
  incomeTransferAccountId: number | null;
  /** Money out that becomes a transfer from `accountId` to this account, instead of spending. */
  expenseTransferAccountId: number | null;
  enabled: boolean;
};

export type SmsProposal = {
  providerKey: string;
  direction: SmsDirection;
  /** What to add: income or spending for the SMS's flow, or a transfer between two accounts. */
  type: SmsDirection | 'transfer';
  amount: Paise;
  transactionDate: IsoDate;
  reference: string | null;
  description: string;
  ruleId: number | null;
  /** The transaction's account; for a transfer, the account the money left. */
  accountId: number | null;
  /** Only for a transfer: the account the money went to. */
  toAccountId: number | null;
  categoryId: number | null;
  strict: boolean;
  reasons: string[];
};

export type SmsParseResult =
  | { ok: true; proposal: SmsProposal }
  | { ok: false; reasons: string[] };

export function normalizeSmsText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 11/10/2026, 11-10-26 */
const NUMERIC_DATE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g;
/** 11-Oct-26, 11 October 2026, 11Oct26 */
const NAMED_DATE =
  /\b(\d{1,2})[-/ ]?(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)(?![A-Z])[-/ ,]*(\d{4}|\d{2})\b/gi;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function isoDate(day: string, month: string, year: string): IsoDate | null {
  const date = `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isValidDate(date) ? date : null;
}

/** The first date written in the SMS, and where it is; `date` is null when it isn't a real day. */
function firstDate(body: string): { index: number; length: number; date: IsoDate | null } | null {
  const found = [
    ...[...body.matchAll(NUMERIC_DATE)].map((match) => ({
      index: match.index,
      length: match[0].length,
      date: isoDate(match[1]!, match[2]!, match[3]!),
    })),
    ...[...body.matchAll(NAMED_DATE)].map((match) => ({
      index: match.index,
      length: match[0].length,
      date: isoDate(
        match[1]!,
        String(MONTHS.indexOf(match[2]!.slice(0, 3).toUpperCase()) + 1),
        match[3]!,
      ),
    })),
  ];
  return found.sort((a, b) => a.index - b.index)[0] ?? null;
}

/** Replace volatile values so a learned rule describes structure, not private data. */
export function smsTemplateFingerprint(body: string): string {
  const normalized = normalizeSmsText(body)
    .replace(/\b(?:₹|INR|Rs\.?)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, '<AMOUNT>')
    .replace(NUMERIC_DATE, '<DATE>')
    .replace(NAMED_DATE, '<DATE>')
    .replace(/\b(?:UPI|UTR|REF(?:ERENCE)?|TXN|TRANSACTION)\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi, '<REFERENCE>')
    .replace(/\b\d{6,}\b/g, '<NUMBER>')
    // References such as 'IN12345678' or 'CHASH0001234' join letters to a long number.
    // A UPI handle ('shop123456@ybl') names the payee, so it stays.
    .replace(/\b[A-Z0-9]*\d{6,}[A-Z0-9]*\b(?!@)/gi, '<NUMBER>');
  return createHash('sha256').update(normalized.toUpperCase()).digest('hex');
}

/**
 * Indian senders look like 'JD-ICICIT-S': a route prefix that changes from one SMS to the
 * next, the bank's registered ID, and an optional type letter. Learn the registered ID so
 * the same bank matches whichever route delivered it; any other sender is matched exactly.
 */
export function learnedSenderPattern(sender: string): string {
  const normalized = normalizeSmsText(sender);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const registered = normalized.match(/^[A-Z]{2}-([A-Z0-9]{3,9})(?:-[A-Z])?$/i);
  return registered
    ? `^[A-Z]{2}-${escape(registered[1]!)}(?:-[A-Z])?$`
    : `^${escape(normalized)}$`;
}

export function learnedProviderKey(sender: string, body: string): string {
  const bank = body.match(/\b(?:FROM|AT|VIA)\s+([A-Z][A-Z0-9 &.-]{2,40}?)(?:\s+(?:A\/C|ACCOUNT|CARD)\b|[,.]|$)/i);
  return normalizeSmsText(bank?.[1] ?? sender);
}

export function smsContentHash(sender: string, body: string): string {
  return createHash('sha256')
    .update(`${normalizeSmsText(sender).toUpperCase()}\n${normalizeSmsText(body)}`)
    .digest('hex');
}

export function smsDedupeKey(input: Pick<SmsEnvelope, 'sender' | 'body' | 'messageId'>): string {
  return input.messageId?.trim() || smsContentHash(input.sender, input.body);
}

function parseDate(body: string, receivedAt: string): IsoDate | null {
  const written = firstDate(body)?.date;
  if (written) return written;
  const date = receivedAt.slice(0, 10);
  return isValidDate(date) ? date : null;
}

export function smsTransactionDate(body: string, receivedAt: string): IsoDate | null {
  return parseDate(body, receivedAt);
}

/** 'Avl Bal Rs 1,200', 'available limit is Rs 5,000', 'Updated balance is Rs 80' */
const BALANCE_BEFORE =
  /\b(?:AVL|AVAILABLE|UPDATED|CLOSING)\.?\s*(?:BAL(?:ANCE)?|LIMIT|LMT)\.?(?:\s+IS)?\s*[:.-]?\s*$/i;

/** The amounts written in the SMS, leaving out a balance or limit stated after the transaction. */
function amountMatches(body: string): { index: number; length: number; value: Paise }[] {
  return [...body.matchAll(/(?:₹|INR|Rs\.?|amount(?:\s+of)?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)]
    .filter((match) => !BALANCE_BEFORE.test(body.slice(Math.max(0, match.index - 30), match.index)))
    .flatMap((match) => {
      const value = parsePaise(match[1]!);
      return value.ok && value.value > 0
        ? [{ index: match.index, length: match[0].length, value: value.value }]
        : [];
    });
}

function parseAmount(body: string): Paise | null {
  const amounts = amountMatches(body);
  return amounts.length === 1 ? amounts[0]!.value : null;
}

export function smsAmount(body: string): Paise | null {
  return parseAmount(body);
}

// 'Credit Card' and 'Debit Card' name a card, not a flow; 'Sent Rs 50' is money out.
const DEBIT = String.raw`DEBITED|DEBIT(?!\s+CARDS?\b)|SPENT|PAID|WITHDRAWN|PURCHASE|SENT(?=\s*(?:₹|INR|RS\.?\s*\d))`;
const CREDIT = String.raw`CREDITED|CREDIT(?!\s+(?:CARDS?|LIMIT)\b)|RECEIVED|DEPOSITED|REFUND`;
const DEBIT_WORDS = new RegExp(String.raw`\b(?:${DEBIT})\b`);
const CREDIT_WORDS = new RegExp(String.raw`\b(?:${CREDIT})\b`);
/** The owner's own masked account number: 'Acct XX123', 'A/c no. XX1234', 'Account *1234'. */
const OWN_ACCOUNT = /\b(?:A\/C|ACCT|ACCOUNT)\.?\s*(?:NO\.?\s*)?[X*]+\d{3,}/;

function flowWords(text: string): SmsDirection | null {
  const debit = DEBIT_WORDS.test(text);
  const credit = CREDIT_WORDS.test(text);
  return debit === credit ? null : debit ? 'expense' : 'income';
}

function parseDirection(body: string): SmsDirection | null {
  const upper = body.toUpperCase();
  const flow = flowWords(upper);
  if (flow || !DEBIT_WORDS.test(upper)) return flow;
  // 'Acct XX123 debited for Rs 500 on 05-Oct-26; ASHA credited.' says both words, but
  // only the clause naming the owner's account says which way their money went.
  const own = upper.split(';').filter((clause) => OWN_ACCOUNT.test(clause));
  return own.length === 1 ? flowWords(own[0]!) : null;
}

export function smsDirection(body: string): SmsDirection | null {
  return parseDirection(body);
}

function parseReference(body: string): string | null {
  const match = body.match(/\b(?:UPI|UTR|REF(?:ERENCE)?|TXN|TRANSACTION)\s*[:#-]?\s*([A-Z0-9-]{5,})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export type SmsHighlightKind = 'amount' | 'direction' | 'date' | 'reference' | 'merchant';
export type SmsHighlight = { start: number; end: number; kind: SmsHighlightKind };

/**
 * Character ranges in the SMS as shown to the owner that the parser read, using
 * the same rules: an amount only when there is exactly one, a flow word only when
 * the flow is clear. Overlaps keep the earlier kind in the list above.
 */
export function smsHighlights(body: string): SmsHighlight[] {
  const found: SmsHighlight[] = [];
  const amounts = amountMatches(body);
  if (amounts.length === 1) {
    const amount = amounts[0]!;
    found.push({ start: amount.index, end: amount.index + amount.length, kind: 'amount' });
  }
  const direction = parseDirection(body);
  if (direction) {
    const words = new RegExp(String.raw`\b(?:${direction === 'expense' ? DEBIT : CREDIT})\b`, 'i');
    const match = words.exec(body);
    if (match) found.push({ start: match.index, end: match.index + match[0].length, kind: 'direction' });
  }
  const date = firstDate(body);
  if (date?.date) found.push({ start: date.index, end: date.index + date.length, kind: 'date' });
  const reference = /\b(?:UPI|UTR|REF(?:ERENCE)?|TXN|TRANSACTION)\s*[:#-]?\s*([A-Z0-9-]{5,})\b/di.exec(body);
  const referenceAt = reference?.indices?.[1];
  if (referenceAt) found.push({ start: referenceAt[0], end: referenceAt[1], kind: 'reference' });
  const merchant = /\b(?:FROM|AT|VIA)\s+([A-Z][A-Z0-9 &.-]{2,40}?)(?:\s+(?:A\/C|ACCOUNT|CARD)\b|[,.]|$)/di.exec(body);
  const merchantAt = merchant?.indices?.[1];
  if (merchantAt) found.push({ start: merchantAt[0], end: merchantAt[1], kind: 'merchant' });

  const kept: SmsHighlight[] = [];
  for (const range of found) {
    if (kept.some((other) => range.start < other.end && other.start < range.end)) continue;
    kept.push(range);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function parseSms(envelope: SmsEnvelope, rules: SmsRuleInput[] = []): SmsParseResult {
  const sender = normalizeSmsText(envelope.sender);
  const body = normalizeSmsText(envelope.body);
  const reasons: string[] = [];
  if (envelope.schemaVersion !== 1) reasons.push('Unsupported SMS envelope version.');
  if (!sender) reasons.push('The SMS sender is missing.');
  if (!body) reasons.push('The SMS body is empty.');
  if (body.length > 4096) reasons.push('The SMS body is too long.');

  const direction = parseDirection(body);
  if (!direction) reasons.push('The message does not clearly say debit or credit.');
  const amount = parseAmount(body);
  if (amount === null) reasons.push('The message does not contain one unambiguous INR amount.');
  const transactionDate = parseDate(body, envelope.receivedAt);
  if (!transactionDate) reasons.push('The message does not contain a valid transaction date.');

  const fingerprint = smsTemplateFingerprint(body);
  const rule = rules.find((candidate) => {
    if (!candidate.enabled || !new RegExp(candidate.senderPattern, 'i').test(sender)) return false;
    return !candidate.templateFingerprint || candidate.templateFingerprint === fingerprint;
  }) ?? null;
  if (!rule) reasons.push('No enabled provider rule matches this sender.');

  const side = rule
    ? direction === 'income'
      ? { categoryId: rule.incomeCategoryId, transferAccountId: rule.incomeTransferAccountId }
      : { categoryId: rule.expenseCategoryId, transferAccountId: rule.expenseTransferAccountId }
    : { categoryId: null, transferAccountId: null };
  const transfer = side.transferAccountId !== null;
  if (!side.categoryId && !transfer) reasons.push('No category is configured for this direction.');

  if (reasons.length > 0 || direction === null || amount === null || transactionDate === null) {
    return { ok: false, reasons };
  }

  const reference = parseReference(body);
  return {
    ok: true,
    proposal: {
      providerKey: rule!.providerKey,
      direction,
      type: transfer ? 'transfer' : direction,
      amount,
      transactionDate,
      reference,
      description: reference ? `${rule!.providerKey} ${reference}` : rule!.providerKey,
      ruleId: rule!.id,
      accountId: transfer && direction === 'income' ? side.transferAccountId : rule!.accountId,
      toAccountId: !transfer
        ? null
        : direction === 'income'
          ? rule!.accountId
          : side.transferAccountId,
      categoryId: transfer ? null : side.categoryId,
      strict: true,
      reasons: [],
    },
  };
}
