import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`Redirected to ${path}`);
  },
}));

const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-workspace-'));
process.env.DATABASE_PATH = join(directory, 'workspace.db');
process.env.SMS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const { db, sqlite } = await import('@/lib/db/client');
const { accounts, categories, smsDevices, smsMessages, smsRules, transactions } =
  await import('@/lib/db/schema');
const { encryptSmsBody } = await import('@/lib/sms/security');
const { pendingSmsMessage, pendingSmsMessages, pendingSmsDeviceRows, smsDeviceRows } =
  await import('@/lib/queries/sms');
const {
  manageSmsDeviceFormAction,
  requestSmsDevicePairing,
  rejectSmsFormAction,
  reviewSmsFormAction,
} = await import('@/lib/actions/sms');
const { SmsReviewForm } = await import('@/components/SmsWorkspace/SmsWorkspace');

const account = db
  .insert(accounts)
  .values({
    name: 'Invented wallet',
    type: 'wallet',
    openingDate: '2026-01-01',
  })
  .returning({ id: accounts.id })
  .get();
const category = db
  .insert(categories)
  .values({
    name: 'Invented groceries',
    kind: 'expense',
    color: 'c1',
  })
  .returning({ id: categories.id })
  .get();
const incomeCategory = db
  .insert(categories)
  .values({
    name: 'Invented income',
    kind: 'income',
    color: 'c2',
  })
  .returning({ id: categories.id })
  .get();
const device = db
  .insert(smsDevices)
  .values({
    label: 'Invented phone',
    claimHash: 'invented-claim-hash',
    code: 'ABC123',
    approvedAt: '2026-10-07T08:00:00.000Z',
  })
  .returning({ id: smsDevices.id })
  .get();
let sequence = 0;

afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

const createMessage = (direction: 'expense' | null = 'expense') => {
  const rawBody = `INR 1,250.50 debited at Invented Shop. Ref DEMO${++sequence}`;
  const row = db
    .insert(smsMessages)
    .values({
      deviceId: device.id,
      sender: 'DEMO-ALERT',
      receivedAt: '2026-10-07T08:00:00+05:30',
      contentHash: `invented-content-${sequence}`,
      rawCiphertext: encryptSmsBody(rawBody),
      status: 'pending',
      parserVersion: '1',
      providerKey: 'Invented Shop',
      senderPattern: '^DEMO-ALERT$',
      templateFingerprint: `invented-template-${sequence}`,
      direction,
      amount: 125050,
      transactionDate: '2026-10-07',
      reason: 'Check the account and category.',
    })
    .returning({ id: smsMessages.id })
    .get();
  return { id: row.id, rawBody };
};

const reviewData = (id: number, intent: 'approve' | 'learn' = 'approve') => {
  const form = new FormData();
  form.set('id', String(id));
  form.set('intent', intent);
  form.set('date', '2026-10-08');
  form.set('amount', '99.40');
  form.set('accountId', String(account.id));
  form.set('categoryId', String(category.id));
  form.set('description', 'Edited invented purchase');
  return form;
};

describe('Money SMS workspace', () => {
  it('keeps queue summaries ciphertext-free and decrypts only the opened pending item', () => {
    const { id, rawBody } = createMessage();
    const queue = pendingSmsMessages();
    expect(queue.some((message) => message.id === id)).toBe(true);
    expect(JSON.stringify(queue)).not.toContain(rawBody);
    expect(queue.find((message) => message.id === id)).not.toHaveProperty('rawCiphertext');
    expect(pendingSmsMessage(id)).toMatchObject({ id, body: rawBody, bodyError: null });
    expect(pendingSmsMessage(id)).not.toHaveProperty('rawCiphertext');
  });

  it('explains why a pending SMS cannot be decrypted instead of showing an empty success', () => {
    const { id } = createMessage();
    const previousKey = process.env.SMS_ENCRYPTION_KEY;
    delete process.env.SMS_ENCRYPTION_KEY;
    try {
      expect(pendingSmsMessage(id)).toMatchObject({
        body: null,
        bodyError: 'Set a valid SMS_ENCRYPTION_KEY on the server to review this message.',
      });
    } finally {
      process.env.SMS_ENCRYPTION_KEY = previousKey;
    }
  });

  it('does not crash the review page when the configured decryption key changed', () => {
    const { id } = createMessage();
    const previousKey = process.env.SMS_ENCRYPTION_KEY;
    process.env.SMS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    try {
      expect(pendingSmsMessage(id)).toMatchObject({
        body: null,
        bodyError:
          'The original SMS cannot be decrypted. Restore its SMS_ENCRYPTION_KEY or reject this message.',
      });
    } finally {
      process.env.SMS_ENCRYPTION_KEY = previousKey;
    }
  });

  it('shows a clear error for a damaged encrypted message', () => {
    const { id } = createMessage();
    db.update(smsMessages)
      .set({ rawCiphertext: 'not.valid.parts' })
      .where(eq(smsMessages.id, id))
      .run();
    expect(pendingSmsMessage(id)).toMatchObject({
      body: null,
      bodyError: 'The original SMS is damaged. Restore a backup or reject this message.',
    });
  });

  it('uses one visible set of inputs for both approval choices', () => {
    const { id } = createMessage();
    const message = pendingSmsMessage(id);
    expect(message).not.toBeNull();
    if (!message) return;
    const html = renderToStaticMarkup(
      createElement(SmsReviewForm, {
        message,
        canReview: true,
        accounts: [{ id: account.id, name: 'Invented wallet' }],
        categories: [
          { id: category.id, name: 'Invented groceries', kind: 'expense', archived: false },
          { id: incomeCategory.id, name: 'Invented income', kind: 'income', archived: false },
        ],
      }),
    );
    expect(html.match(/name="date"/g)).toHaveLength(1);
    expect(html.match(/name="amount"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*value="approve" name="intent"/);
    expect(html).toMatch(/<button[^>]*value="learn" name="intent"/);
    expect(html).not.toContain('type="hidden" name="amount"');
    expect(html).toContain('Invented groceries');
    expect(html).not.toContain('Invented income');
  });

  it('groups both directions when the SMS cannot infer one and requires an explicit category', () => {
    const { id } = createMessage(null);
    const message = pendingSmsMessage(id);
    expect(message).not.toBeNull();
    if (!message) return;
    const html = renderToStaticMarkup(
      createElement(SmsReviewForm, {
        message,
        canReview: true,
        accounts: [{ id: account.id, name: 'Invented wallet' }],
        categories: [
          { id: category.id, name: 'Invented groceries', kind: 'expense', archived: false },
          { id: incomeCategory.id, name: 'Invented income', kind: 'income', archived: false },
        ],
      }),
    );
    expect(html).toContain('<optgroup label="Spending">');
    expect(html).toContain('<optgroup label="Income">');
    expect(html).toContain('Invented groceries');
    expect(html).toContain('Invented income');
    expect(html).toMatch(/<select[^>]*name="categoryId"[^>]*required/);
    expect(html).toMatch(/<button(?![^>]*disabled)(?=[^>]*value="approve")[^>]*>/);
    expect(html).not.toContain('value="learn"');
  });

  it('explains when no active category can classify an unclear SMS', () => {
    const { id } = createMessage(null);
    const message = pendingSmsMessage(id);
    expect(message).not.toBeNull();
    if (!message) return;
    const html = renderToStaticMarkup(
      createElement(SmsReviewForm, {
        message,
        canReview: true,
        accounts: [{ id: account.id, name: 'Invented wallet' }],
        categories: [
          { id: category.id, name: 'Invented groceries', kind: 'expense', archived: true },
        ],
      }),
    );
    expect(html).toContain('No active category is available.');
    expect(html).toContain('href="/money/categories"');
    expect(html).not.toContain('Invented groceries');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
  });

  it('disables approval when the original message cannot be viewed', () => {
    const { id } = createMessage();
    const message = pendingSmsMessage(id);
    expect(message).not.toBeNull();
    if (!message) return;
    const html = renderToStaticMarkup(
      createElement(SmsReviewForm, {
        message,
        canReview: false,
        accounts: [{ id: account.id, name: 'Invented wallet' }],
        categories: [
          { id: category.id, name: 'Invented groceries', kind: 'expense', archived: false },
        ],
      }),
    );
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="learn")[^>]*>/);
    expect(html).toContain('Reject and delete');
  });

  it('links to missing accounts and categories rather than presenting unusable controls', () => {
    const { id } = createMessage();
    const message = pendingSmsMessage(id);
    expect(message).not.toBeNull();
    if (!message) return;
    const html = renderToStaticMarkup(
      createElement(SmsReviewForm, {
        message,
        canReview: true,
        accounts: [],
        categories: [],
      }),
    );
    expect(html).toContain('href="/money/accounts"');
    expect(html).toContain('href="/money/categories"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
  });

  it('uses edited form values for learning and removes the original SMS after import', async () => {
    const { id } = createMessage();
    await expect(reviewSmsFormAction(null, reviewData(id, 'learn'))).rejects.toThrow(
      'Redirected to /money/sms',
    );
    const imported = db.select().from(smsMessages).where(eq(smsMessages.id, id)).get();
    expect(imported).toMatchObject({ status: 'imported', rawCiphertext: null });
    expect(pendingSmsMessage(id)).toBeNull();
    const transaction = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, imported!.transactionId!))
      .get();
    expect(transaction).toMatchObject({
      date: '2026-10-08',
      amount: 9940,
      accountId: account.id,
      categoryId: category.id,
      description: 'Edited invented purchase',
    });
    expect(
      db
        .select()
        .from(smsRules)
        .where(eq(smsRules.templateFingerprint, `invented-template-${sequence}`))
        .get(),
    ).toMatchObject({ accountId: account.id, expenseCategoryId: category.id });
  });

  it('reports failed validation and retains the pending encrypted message', async () => {
    const { id } = createMessage();
    const invalid = reviewData(id);
    invalid.set('amount', '0');
    const result = await reviewSmsFormAction(null, invalid);
    expect(result).toMatchObject({ ok: false, message: 'Enter an amount greater than zero.' });
    expect(pendingSmsMessage(id)?.body).toBeTruthy();
    expect(await reviewSmsFormAction(null, new FormData())).toMatchObject({
      ok: false,
      message: 'Choose how to review this SMS.',
    });
  });

  it('uses a chosen spending category to approve an unclear SMS without learning a rule', async () => {
    const { id } = createMessage(null);
    await expect(reviewSmsFormAction(null, reviewData(id))).rejects.toThrow(
      'Redirected to /money/sms',
    );
    const imported = db.select().from(smsMessages).where(eq(smsMessages.id, id)).get();
    expect(imported).toMatchObject({
      status: 'imported',
      direction: 'expense',
      rawCiphertext: null,
    });
    expect(
      db.select().from(transactions).where(eq(transactions.id, imported!.transactionId!)).get(),
    ).toMatchObject({ type: 'expense', categoryId: category.id, amount: 9940 });
    expect(
      db
        .select()
        .from(smsRules)
        .where(eq(smsRules.templateFingerprint, `invented-template-${sequence}`))
        .get(),
    ).toBeUndefined();
  });

  it('uses a chosen income category to approve an unclear SMS', async () => {
    const { id } = createMessage(null);
    const form = reviewData(id);
    form.set('categoryId', String(incomeCategory.id));
    await expect(reviewSmsFormAction(null, form)).rejects.toThrow('Redirected to /money/sms');
    const imported = db.select().from(smsMessages).where(eq(smsMessages.id, id)).get();
    expect(imported).toMatchObject({
      status: 'imported',
      direction: 'income',
      rawCiphertext: null,
    });
    expect(
      db.select().from(transactions).where(eq(transactions.id, imported!.transactionId!)).get(),
    ).toMatchObject({ type: 'income', categoryId: incomeCategory.id, amount: 9940 });
  });

  it('blocks rule learning for unclear SMS and still allows rejection', async () => {
    const { id } = createMessage(null);
    const noCategory = reviewData(id);
    noCategory.delete('categoryId');
    expect(await reviewSmsFormAction(null, noCategory)).toMatchObject({ ok: false });
    expect(await reviewSmsFormAction(null, reviewData(id, 'learn'))).toMatchObject({
      ok: false,
      message: 'The SMS direction is unclear. Choose a category and approve it manually instead.',
    });
    expect(pendingSmsMessage(id)?.body).toBeTruthy();
    expect(
      db
        .select()
        .from(smsRules)
        .where(eq(smsRules.templateFingerprint, `invented-template-${sequence}`))
        .get(),
    ).toBeUndefined();
    const rejectForm = new FormData();
    rejectForm.set('id', String(id));
    await expect(rejectSmsFormAction(null, rejectForm)).rejects.toThrow('Redirected to /money/sms');
    expect(pendingSmsMessage(id)).toBeNull();
    expect(db.select().from(smsMessages).where(eq(smsMessages.id, id)).get()).toMatchObject({
      status: 'rejected',
      rawCiphertext: null,
    });
  });

  it('does not override an inferred direction with a category of the other kind', async () => {
    const { id } = createMessage('expense');
    const form = reviewData(id);
    form.set('categoryId', String(incomeCategory.id));
    expect(await reviewSmsFormAction(null, form)).toMatchObject({
      ok: false,
      message: 'Choose a spending category.',
    });
    expect(pendingSmsMessage(id)?.body).toBeTruthy();
  });

  it('reports device errors and updates connection requests on approval/revocation', async () => {
    const requested = await requestSmsDevicePairing({ label: 'Invented second phone' });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(pendingSmsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(true);
    const form = new FormData();
    form.set('id', String(requested.deviceId));
    form.set('intent', 'approve');
    expect(await manageSmsDeviceFormAction(null, form)).toEqual({
      ok: true,
      message: 'Device approved.',
    });
    expect(pendingSmsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(false);
    expect(smsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(true);
    expect(await manageSmsDeviceFormAction(null, form)).toMatchObject({ ok: false });
    form.set('intent', 'revoke');
    expect(await manageSmsDeviceFormAction(null, form)).toEqual({
      ok: true,
      message: 'Device revoked.',
    });
    expect(
      smsDeviceRows().find((item) => item.id === requested.deviceId)?.revokedAt,
    ).not.toBeNull();
  });
});
