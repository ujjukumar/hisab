import { createHash } from 'node:crypto';
import { parsePaise, type Paise } from './money';
import { isValidDate, type IsoDate } from './dates';

export const SMS_PARSER_VERSION = '1';

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
  enabled: boolean;
};

export type SmsProposal = {
  providerKey: string;
  direction: SmsDirection;
  amount: Paise;
  transactionDate: IsoDate;
  reference: string | null;
  description: string;
  ruleId: number | null;
  accountId: number | null;
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

/** Replace volatile values so a learned rule describes structure, not private data. */
export function smsTemplateFingerprint(body: string): string {
  const normalized = normalizeSmsText(body)
    .replace(/\b(?:₹|INR|Rs\.?)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, '<AMOUNT>')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '<DATE>')
    .replace(/\b(?:UPI|UTR|REF(?:ERENCE)?|TXN|TRANSACTION)\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi, '<REFERENCE>')
    .replace(/\b\d{6,}\b/g, '<NUMBER>');
  return createHash('sha256').update(normalized.toUpperCase()).digest('hex');
}

export function learnedSenderPattern(sender: string): string {
  return `^${normalizeSmsText(sender).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
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
  const match = body.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (match) {
    const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
    const date = `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
    if (isValidDate(date)) return date;
  }
  const date = receivedAt.slice(0, 10);
  return isValidDate(date) ? date : null;
}

export function smsTransactionDate(body: string, receivedAt: string): IsoDate | null {
  return parseDate(body, receivedAt);
}

function parseAmount(body: string): Paise | null {
  const matches = [...body.matchAll(/(?:₹|INR|Rs\.?|amount(?:\s+of)?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)];
  const candidates = matches
    .map((match) => parsePaise(match[1]!))
    .filter((result): result is { ok: true; value: Paise } => result.ok && result.value > 0)
    .map((result) => result.value);
  return candidates.length === 1 ? candidates[0]! : null;
}

export function smsAmount(body: string): Paise | null {
  return parseAmount(body);
}

function parseDirection(body: string): SmsDirection | null {
  const upper = body.toUpperCase();
  const debit = /\b(DEBITED|DEBIT|SPENT|PAID|WITHDRAWN|PURCHASE)\b/.test(upper);
  const credit = /\b(CREDITED|CREDIT|RECEIVED|DEPOSITED|REFUND)\b/.test(upper);
  return debit === credit ? null : debit ? 'expense' : 'income';
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
  const amounts = [...body.matchAll(/(?:₹|INR|Rs\.?|amount(?:\s+of)?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)]
    .filter((match) => {
      const value = parsePaise(match[1]!);
      return value.ok && value.value > 0;
    });
  if (amounts.length === 1) {
    const match = amounts[0]!;
    found.push({ start: match.index, end: match.index + match[0].length, kind: 'amount' });
  }
  const direction = parseDirection(body);
  if (direction) {
    const words =
      direction === 'expense'
        ? /\b(?:DEBITED|DEBIT|SPENT|PAID|WITHDRAWN|PURCHASE)\b/i
        : /\b(?:CREDITED|CREDIT|RECEIVED|DEPOSITED|REFUND)\b/i;
    const match = words.exec(body);
    if (match) found.push({ start: match.index, end: match.index + match[0].length, kind: 'direction' });
  }
  const date = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(body);
  if (date) {
    const year = date[3]!.length === 2 ? `20${date[3]}` : date[3]!;
    if (isValidDate(`${year}-${date[2]!.padStart(2, '0')}-${date[1]!.padStart(2, '0')}`)) {
      found.push({ start: date.index, end: date.index + date[0].length, kind: 'date' });
    }
  }
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

  const categoryId = rule
    ? direction === 'income'
      ? rule.incomeCategoryId
      : rule.expenseCategoryId
    : null;
  if (!categoryId) reasons.push('No category is configured for this direction.');

  if (reasons.length > 0 || direction === null || amount === null || transactionDate === null) {
    return { ok: false, reasons };
  }

  const reference = parseReference(body);
  return {
    ok: true,
    proposal: {
      providerKey: rule!.providerKey,
      direction,
      amount,
      transactionDate,
      reference,
      description: reference ? `${rule!.providerKey} ${reference}` : rule!.providerKey,
      ruleId: rule!.id,
      accountId: rule!.accountId,
      categoryId,
      strict: true,
      reasons: [],
    },
  };
}
