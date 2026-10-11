import { describe, expect, it } from 'vitest';
import {
  normalizeSmsText,
  parseSms,
  learnedProviderKey,
  learnedSenderPattern,
  smsTemplateFingerprint,
  smsContentHash,
  smsDedupeKey,
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
  enabled: true,
};

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
        amount: 125050,
        transactionDate: '2026-10-07',
        reference: 'ABC12345',
        description: 'Sample Bank ABC12345',
        ruleId: 3,
        accountId: 2,
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
});

describe('learned SMS rule helpers', () => {
  it('normalizes volatile values into the same fingerprint', () => {
    expect(smsTemplateFingerprint('INR 1,250 credited on 07/10/2026. UPI ABC12345')).toBe(
      smsTemplateFingerprint('INR 9,999 credited on 08/10/2026. UPI XYZ98765'),
    );
  });

  it('escapes sender text when making an exact pattern', () => {
    expect(learnedSenderPattern('BANK.INFO+1')).toBe('^BANK\\.INFO\\+1$');
  });

  it('derives a provider key from a structured message', () => {
    expect(learnedProviderKey('BANK-INFO', 'INR 100 credited FROM Sample Bank A/C')).toBe('Sample Bank');
    expect(learnedProviderKey('BANK-INFO', 'INR 100 credited')).toBe('BANK-INFO');
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
