import { describe, expect, it } from 'vitest';
import {
  normalizeSmsText,
  parseSms,
  learnedProviderKey,
  learnedSenderPattern,
  smsAmount,
  smsDirection,
  smsTemplateFingerprint,
  smsContentHash,
  smsDedupeKey,
  smsHighlights,
  smsTransactionDate,
  type SmsEnvelope,
} from '@/lib/domain/sms';
import { decryptSmsBody, encryptSmsBody, hashSmsToken } from '@/lib/sms/security';

const rule = {
  id: 3,
  senderPattern: '^BANK-',
  providerKey: 'Sample Bank',
  templateFingerprint: null,
  accountId: 2,
  incomeCategoryId: 4,
  expenseCategoryId: 5,
  incomeTransferAccountId: null,
  expenseTransferAccountId: null,
  enabled: true,
};

/** Invented wording in the shape some banks use when the owner pays a card or a person. */
const PAID_OUT = 'Acct XX123 debited for Rs 18240.00 on 05-Oct-26; Sample Cards credited. UPI:512345678901.';

const envelope = (body: string): SmsEnvelope => ({
  schemaVersion: 1,
  messageId: 'msg-7',
  sender: 'BANK-INFO',
  receivedAt: '2026-10-07T08:00:00+05:30',
  body,
});

describe('SMS normalization and deduplication', () => {
  it('normalizes whitespace and unicode compatibility forms', () => {
    expect(normalizeSmsText('  Amount   ₹ 1,000  ')).toBe('Amount ₹ 1,000');
  });

  it('hashes equivalent sender/body content consistently', () => {
    expect(smsContentHash('BANK-INFO', '₹1,000 credited')).toBe(
      smsContentHash(' bank-info ', ' ₹1,000   credited '),
    );
    expect(smsDedupeKey(envelope('₹1,000 credited'))).toBe('msg-7');
  });
});

describe('parseSms', () => {
  it('parses a strict credit proposal', () => {
    const result = parseSms(envelope('INR 1,250.50 credited on 07/10/2026. Ref UPI ABC12345'), [rule]);
    expect(result).toEqual({
      ok: true,
      proposal: {
        providerKey: 'Sample Bank',
        direction: 'income',
        type: 'income',
        amount: 125050,
        transactionDate: '2026-10-07',
        reference: 'ABC12345',
        description: 'Sample Bank ABC12345',
        ruleId: 3,
        accountId: 2,
        toAccountId: null,
        categoryId: 4,
        strict: true,
        reasons: [],
      },
    });

  });

  it('parses debit messages as expenses', () => {
    const result = parseSms(envelope('Rs. 85.00 debited on 07/10/2026'), [rule]);
    expect(result.ok && result.proposal.direction).toBe('expense');
    expect(result.ok && result.proposal.categoryId).toBe(5);
  });

  it('queues ambiguous amount or direction instead of guessing', () => {
    const result = parseSms(envelope('₹100 debited and ₹200 credited'), [rule]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('The message does not clearly say debit or credit.');
  });

  it('requires a matching enabled rule and configured category', () => {
    expect(parseSms(envelope('₹100 credited'), []).ok).toBe(false);
    expect(parseSms(envelope('₹100 credited'), [{ ...rule, incomeCategoryId: null }]).ok).toBe(false);
  });

  it('matches a learned template while ignoring volatile values', () => {
    const first = 'INR 1,250 credited on 07/10/2026. UPI ABC12345';
    const second = 'INR 9,999 credited on 08/10/2026. UPI XYZ98765';
    const learned = { ...rule, templateFingerprint: smsTemplateFingerprint(first) };
    expect(parseSms(envelope(second), [learned]).ok).toBe(true);
  });

  it('rejects template drift for a learned rule', () => {
    const learned = {
      ...rule,
      templateFingerprint: smsTemplateFingerprint('INR 1,250 credited on 07/10/2026. UPI ABC12345'),
    };
    expect(parseSms(envelope('INR 1,250 credited on 07/10/2026. Card ABC12345'), [learned]).ok).toBe(false);
  });

  it("reads the owner's own account clause when an SMS names both sides", () => {
    expect(smsDirection(PAID_OUT)).toBe('expense');
    expect(smsDirection('Sample Payer debited for Rs 500; A/c no. XX4321 credited.')).toBe('income');
    expect(smsDirection('Rs 500 debited; Account *4321 credited.')).toBe('income');
    // Both clauses name an account, or none does: still unclear.
    expect(smsDirection('Acct XX1111 debited for Rs 500; Acct XX2222 credited.')).toBeNull();
    expect(smsDirection('Rs 500 debited; Sample Payee credited.')).toBeNull();
    expect(smsDirection('Acct XX1111 debited and credited for Rs 500.')).toBeNull();
  });

  it("doesn't read a card's name as the flow", () => {
    expect(smsDirection('Rs 90 spent on your Demo Credit Card ending 1234 at Invented Mart on 05/10/26.')).toBe(
      'expense',
    );
    expect(smsDirection('Rs 90 refund credited to your Demo Credit Card.')).toBe('income');
    expect(smsDirection('Refund of Rs 90 credited to your Demo Debit Card XX9999.')).toBe('income');
    expect(smsDirection('Rs 90 spent via Demo Debit Card XX9999 at Invented Cafe.')).toBe('expense');
    expect(smsDirection('Demo Credit Card XX1234 statement is ready. Total of Rs 500 is due.')).toBeNull();
    expect(smsDirection('The credit limit for your Demo Credit Card XX1234 has been changed to Rs 50,000.')).toBeNull();
  });

  it('reads money sent as money out', () => {
    expect(smsDirection('Sent Rs.250.00 from Demo Bank AC X1234 to Invented Store on 05-10-26.')).toBe(
      'expense',
    );
    expect(smsDirection('Sent INR 250 to Demo Payee')).toBe('expense');
    expect(smsDirection('Your statement is sent to your email. Total of Rs 500 is due.')).toBeNull();
  });

  it('leaves out a balance or limit stated after the transaction', () => {
    expect(smsAmount('Rs 500 debited on 05/10/26. Avl Bal Rs 12,000.00')).toBe(50000);
    expect(smsAmount('INR 500 debited. Avl bal INR 10,000.00')).toBe(50000);
    expect(smsAmount('Demo Acc XX123 debited Rs 75.00 on 05-Oct-26.Avl Bal-INR 1,000')).toBe(7500);
    expect(smsAmount('Payment of Rs 300 received. Your available limit is Rs.40,000.')).toBe(30000);
    expect(smsAmount('Payment of Rs 300 is successful. Updated balance is Rs 80.')).toBe(30000);
    expect(smsAmount('Rs 300 spent. Avl Lmt: Rs 9,000')).toBe(30000);
    expect(smsAmount('Total of Rs 500 or minimum of Rs 50 is due')).toBeNull();
  });

  it('reads money out as a transfer when the rule says so', () => {
    const result = parseSms(envelope(PAID_OUT), [
      { ...rule, expenseCategoryId: null, expenseTransferAccountId: 9 },
    ]);
    expect(result.ok && result.proposal).toMatchObject({
      direction: 'expense',
      type: 'transfer',
      amount: 1824000,
      accountId: 2,
      toAccountId: 9,
      categoryId: null,
      strict: true,
    });
  });

  it('reads money in as a transfer from the other account', () => {
    const result = parseSms(envelope('INR 500.00 credited on 07/10/2026'), [
      { ...rule, incomeTransferAccountId: 9 },
    ]);
    expect(result.ok && result.proposal).toMatchObject({
      direction: 'income',
      type: 'transfer',
      accountId: 9,
      toAccountId: 2,
      categoryId: null,
    });
  });

  it('keeps the other flow as income or spending when only one side is a transfer', () => {
    const result = parseSms(envelope('INR 500.00 credited on 07/10/2026'), [
      { ...rule, expenseCategoryId: null, expenseTransferAccountId: 9 },
    ]);
    expect(result.ok && result.proposal).toMatchObject({
      type: 'income',
      accountId: 2,
      toAccountId: null,
      categoryId: 4,
    });
  });
});

describe('smsTransactionDate', () => {
  const received = '2026-10-07T08:00:00+05:30';
  const read = (body: string) => smsTransactionDate(body, received);

  it('reads day-first numeric dates', () => {
    expect(read('INR 5 debited on 7/1/2026')).toBe('2026-01-07');
    expect(read('INR 5 debited on 07-01-26')).toBe('2026-01-07');
  });

  it('reads dates written with a month name', () => {
    expect(read(PAID_OUT)).toBe('2026-10-05');
    expect(read('INR 5 debited on 5 October 2026')).toBe('2026-10-05');
    expect(read('INR 5 debited on 05Oct25 at Demo')).toBe('2025-10-05');
    expect(read('INR 5 debited on 1 Sept, 2026')).toBe('2026-09-01');
    expect(read('INR 5 debited on 29-feb-24')).toBe('2024-02-29');
  });

  it('uses the first date in the SMS', () => {
    expect(read('INR 5 debited on 03-Oct-26. Bill due 15/10/2026')).toBe('2026-10-03');
  });

  it('falls back to the day it arrived when the date is missing or impossible', () => {
    expect(read('INR 5 debited at Demo')).toBe('2026-10-07');
    expect(read('INR 5 debited on 29-Feb-25')).toBe('2026-10-07');
    expect(read('INR 5 debited on 31/02/2026')).toBe('2026-10-07');
    expect(read('INR 5 debited at Shop 12 Decor 2026')).toBe('2026-10-07');
    expect(smsTransactionDate('INR 5 debited', 'not a date')).toBeNull();
  });
});

describe('learned SMS rule helpers', () => {
  it('normalizes volatile values into the same fingerprint', () => {
    expect(smsTemplateFingerprint('INR 1,250 credited on 07/10/2026. UPI ABC12345')).toBe(
      smsTemplateFingerprint('INR 9,999 credited on 08/10/2026. UPI XYZ98765'),
    );
  });

  it('treats a reference that joins letters to a long number as volatile', () => {
    expect(
      smsTemplateFingerprint('Transfer with reference number DEMO12345678 for Rs 500 has been credited to Demo Payee.'),
    ).toBe(
      smsTemplateFingerprint('Transfer with reference number DEMO87654321 for Rs 900 has been credited to Demo Payee.'),
    );
    expect(smsTemplateFingerprint('Acct XX123 credited:Rs 5 on 05-Oct-26. Info NEFT-ABCD0001234567-DEMO.')).toBe(
      smsTemplateFingerprint('Acct XX123 credited:Rs 9 on 06-Oct-26. Info NEFT-ABCD0009876543-DEMO.'),
    );
    expect(smsTemplateFingerprint('Acct XX123 credited:Rs 5. Info NEFT-ABCD0001234567-DEMO.')).not.toBe(
      smsTemplateFingerprint('Acct XX123 credited:Rs 5. Info NEFT-ABCD0001234567-SAMPLE.'),
    );
  });

  it('keeps the payee named by a UPI handle with a long number', () => {
    expect(smsTemplateFingerprint('Sent Rs 5 to shop1234567@demo on 05-10-26.')).not.toBe(
      smsTemplateFingerprint('Sent Rs 5 to cafe7654321@demo on 05-10-26.'),
    );
    expect(smsTemplateFingerprint('Sent Rs 5 to 9000000001@demo on 05-10-26.')).toBe(
      smsTemplateFingerprint('Sent Rs 5 to 9000000002@demo on 05-10-26.'),
    );
  });

  it('treats dates written with a month name as volatile too', () => {
    expect(smsTemplateFingerprint(PAID_OUT)).toBe(
      smsTemplateFingerprint(
        'Acct XX123 debited for Rs 420.00 on 12-Nov-26; Sample Cards credited. UPI:512345670000.',
      ),
    );
    expect(smsTemplateFingerprint('INR 5 paid on 3 March 2026 at Demo')).toBe(
      smsTemplateFingerprint('INR 9 paid on 28 Sept 2027 at Demo'),
    );
    expect(smsTemplateFingerprint(PAID_OUT)).not.toBe(
      smsTemplateFingerprint(PAID_OUT.replace('Sample Cards credited', 'Sample Shop credited')),
    );
  });

  it('escapes sender text when making an exact pattern', () => {
    expect(learnedSenderPattern('BANK.INFO+1')).toBe('^BANK\\.INFO\\+1$');
    expect(learnedSenderPattern('BANK-INFO')).toBe('^BANK-INFO$');
  });

  it('learns a registered sender ID for any route prefix and type letter', () => {
    const pattern = learnedSenderPattern('JD-DEMOBK-S');
    expect(pattern).toBe('^[A-Z]{2}-DEMOBK(?:-[A-Z])?$');
    const matches = (sender: string) => new RegExp(pattern, 'i').test(sender);
    expect(['JD-DEMOBK-S', 'VM-DEMOBK-T', 'AX-DEMOBK', 'bt-demobk-s'].every(matches)).toBe(true);
    expect(['DEMOBK', 'VM-DEMOBKX-S', 'VM-XDEMOBK-S', 'ABC-DEMOBK-S'].some(matches)).toBe(false);
  });

  it('matches a rule learned from one route when the next SMS comes by another', () => {
    const body = 'Rs 90 spent on your Demo Credit Card ending 1234 at Invented Mart on 05/10/26.';
    const learned = {
      ...rule,
      senderPattern: learnedSenderPattern('JD-DEMOBK-S'),
      templateFingerprint: smsTemplateFingerprint(body),
    };
    const result = parseSms({ ...envelope(body), sender: 'VM-DEMOBK-T' }, [learned]);
    expect(result.ok && result.proposal).toMatchObject({ direction: 'expense', amount: 9000, ruleId: 3 });
  });

  it('derives a provider key from a structured message', () => {
    expect(learnedProviderKey('BANK-INFO', 'INR 100 credited FROM Sample Bank A/C')).toBe('Sample Bank');
    expect(learnedProviderKey('BANK-INFO', 'INR 100 credited')).toBe('BANK-INFO');
  });
});

describe('smsHighlights', () => {
  const read = (body: string) =>
    smsHighlights(body).map((range) => [range.kind, body.slice(range.start, range.end)]);

  it('marks each part the parser read, in reading order', () => {
    expect(read('INR 1,250.50 debited on 07/10/2026 at Invented Shop. Ref UPI ABC12345')).toEqual([
      ['amount', 'INR 1,250.50'],
      ['direction', 'debited'],
      ['date', '07/10/2026'],
      ['merchant', 'Invented Shop'],
      ['reference', 'ABC12345'],
    ]);
  });

  it('reads the rupee sign and money in', () => {
    expect(read('₹2,000 received from Demo Payer, UPI 123456789')).toEqual([
      ['amount', '₹2,000'],
      ['direction', 'received'],
      ['merchant', 'Demo Payer'],
      ['reference', '123456789'],
    ]);
  });

  it('marks no amount when there is none, a zero, or more than one', () => {
    expect(read('Your one-time code is 4821')).toEqual([]);
    expect(read('INR 0 debited')).toEqual([['direction', 'debited']]);
    expect(read('INR 500 and INR 200 debited')).toEqual([['direction', 'debited']]);
  });

  it('marks the spend, not the balance after it or the card name', () => {
    expect(read('INR 500 debited. Avl bal INR 10,000.00')).toEqual([
      ['amount', 'INR 500'],
      ['direction', 'debited'],
    ]);
    expect(read('Rs 90 spent on your Demo Credit Card ending 1234 at Invented Mart on 05/10/26.')).toEqual([
      ['amount', 'Rs 90'],
      ['direction', 'spent'],
      ['date', '05/10/26'],
    ]);
    expect(read('Sent Rs.40.00 from Demo Bank AC X1234').slice(0, 2)).toEqual([
      ['direction', 'Sent'],
      ['amount', 'Rs.40.00'],
    ]);
  });

  it('marks no flow word when the SMS says both and no impossible date', () => {
    expect(read('Rs. 500 credited and debited on 31/02/2026')).toEqual([['amount', 'Rs. 500']]);
  });

  it("marks the flow word in the owner's own account clause", () => {
    expect(read(PAID_OUT).filter(([kind]) => kind === 'direction')).toEqual([
      ['direction', 'debited'],
    ]);
  });

  it('marks a date written with a month name', () => {
    expect(read(PAID_OUT).filter(([kind]) => kind === 'date')).toEqual([['date', '05-Oct-26']]);
    expect(read('INR 75 paid on 29-Feb-25')).toEqual([
      ['amount', 'INR 75'],
      ['direction', 'paid'],
    ]);
  });

  it('keeps the earlier kind when two parts overlap', () => {
    expect(read('INR 75 paid via UPI ABC12345.')).toEqual([
      ['amount', 'INR 75'],
      ['direction', 'paid'],
      ['reference', 'ABC12345'],
    ]);
  });

  it('keeps offsets right across Windows line breaks', () => {
    expect(read('INR 120 debited\r\nat Demo Cafe.\r\nRef 98765XYZ')).toEqual([
      ['amount', 'INR 120'],
      ['direction', 'debited'],
      ['merchant', 'Demo Cafe'],
      ['reference', '98765XYZ'],
    ]);
  });
});

describe('SMS security helpers', () => {
  it('encrypts and decrypts pending SMS content', () => {
    const previous = process.env.SMS_ENCRYPTION_KEY;
    try {
      process.env.SMS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      const encrypted = encryptSmsBody('invented bank message');
      expect(encrypted).not.toContain('invented bank message');
      expect(decryptSmsBody(encrypted)).toBe('invented bank message');
    } finally {
      if (previous === undefined) delete process.env.SMS_ENCRYPTION_KEY;
      else process.env.SMS_ENCRYPTION_KEY = previous;
    }
  });

  it('hashes tokens without retaining the token', () => {
    expect(hashSmsToken('sample-token')).toHaveLength(64);
    expect(hashSmsToken('sample-token')).not.toBe('sample-token');
  });
});
