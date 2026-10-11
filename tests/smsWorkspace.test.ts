import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/money/sms',
  useSearchParams: () => new URLSearchParams(),
}));

const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-workspace-'));
process.env.DATABASE_PATH = join(directory, 'workspace.db');
process.env.SMS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const { db, sqlite } = await import('@/lib/db/client');
const { accounts, categories, smsDevices, smsMessages, smsRules, transactions } =
  await import('@/lib/db/schema');
const { encryptSmsBody } = await import('@/lib/sms/security');
const {
  pendingSmsCount,
  pendingSmsMessage,
  pendingSmsMessages,
  pendingSmsDeviceRows,
  smsDeviceRows,
  smsHistory,
  smsRuleRows,
  smsTabCounts,
} = await import('@/lib/queries/sms');
const {
  approveSmsBatch,
  claimSmsDeviceToken,
  deleteSmsRule,
  manageSmsDeviceFormAction,
  receiveSms,
  rejectSms,
  rejectSmsBatch,
  requestSmsDevicePairing,
  reviewSmsFormAction,
  setSmsRuleEnabled,
  undoSmsReject,
  undoSmsRuleDelete,
  updateSmsRule,
} = await import('@/lib/actions/sms');
const { SmsReviewForm } = await import('@/components/SmsReviewForm/SmsReviewForm');

const account = db
  .insert(accounts)
  .values({ name: 'Invented wallet', type: 'wallet', openingDate: '2026-01-01' })
  .returning({ id: accounts.id })
  .get();
const category = db
  .insert(categories)
  .values({ name: 'Invented groceries', kind: 'expense', color: 'c1' })
  .returning({ id: categories.id })
  .get();
const incomeCategory = db
  .insert(categories)
  .values({ name: 'Invented income', kind: 'income', color: 'c2' })
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

const createMessage = (direction: 'expense' | 'income' | null = 'expense') => {
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

const stored = (id: number) => db.select().from(smsMessages).where(eq(smsMessages.id, id)).get();

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

const bothCategories = [
  { id: category.id, name: 'Invented groceries', kind: 'expense' as const, archived: false },
  { id: incomeCategory.id, name: 'Invented income', kind: 'income' as const, archived: false },
];

function renderForm(
  id: number,
  overrides: Partial<Parameters<typeof SmsReviewForm>[0]> = {},
): string {
  const message = pendingSmsMessage(id);
  if (!message) throw new Error('The invented SMS is not pending.');
  return renderToStaticMarkup(
    createElement(SmsReviewForm, {
      message: {
        id: message.id,
        sender: message.sender,
        direction: message.direction,
        amount: message.amount,
        date: message.transactionDate,
        providerKey: message.providerKey,
        canLearn: Boolean(message.direction && message.templateFingerprint),
      },
      suggestion: { accountId: account.id, categoryId: category.id },
      canReview: message.body !== null,
      accounts: [{ id: account.id, name: 'Invented wallet' }],
      categories: bothCategories,
      afterHref: '/money/sms',
      skipHref: null,
      restoreHref: `/money/sms?message=${id}`,
      ...overrides,
    }),
  );
}

describe('SMS review queue and message', () => {
  it('keeps queue summaries ciphertext-free and decrypts only the opened pending item', () => {
    const { id, rawBody } = createMessage();
    const queue = pendingSmsMessages();
    expect(queue.find((message) => message.id === id)).toMatchObject({
      deviceLabel: 'Invented phone',
    });
    expect(JSON.stringify(queue)).not.toContain(rawBody);
    expect(queue.find((message) => message.id === id)).not.toHaveProperty('rawCiphertext');
    expect(pendingSmsMessage(id)).toMatchObject({ id, body: rawBody, bodyError: null });
    expect(pendingSmsMessage(id)).not.toHaveProperty('rawCiphertext');
  });

  it('counts pending SMS and phone requests for the tab badges', async () => {
    const before = smsTabCounts();
    createMessage();
    const requested = await requestSmsDevicePairing({ label: 'Invented tablet' });
    expect(requested.ok).toBe(true);
    expect(smsTabCounts()).toEqual({ pending: before.pending + 1, requests: before.requests + 1 });
    expect(pendingSmsCount()).toBe(before.pending + 1);
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
});

describe('SMS review form', () => {
  it('shows one set of inputs, the known flow and only categories of that kind', () => {
    const { id } = createMessage();
    const html = renderForm(id);
    expect(html.match(/name="date"/g)).toHaveLength(1);
    expect(html.match(/name="amount"/g)).toHaveLength(1);
    expect(html).not.toContain('name="direction"');
    expect(html).toContain('Money out');
    expect(html).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*name="intent")(?=[^>]*value="approve")[^>]*>/,
    );
    expect(html).toContain('Approve transaction');
    expect(html).toContain('Import similar SMS automatically');
    expect(html).toContain('Invented groceries');
    expect(html).not.toContain('Invented income');
    expect(html).toContain('Original SMS text is erased once you approve or reject it.');
  });

  it('asks for money in or out when the SMS does not say, and cannot learn a rule', () => {
    const { id } = createMessage(null);
    const html = renderForm(id);
    expect(html).toContain('type="hidden" name="direction" value="expense"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Invented groceries');
    expect(html).not.toContain('Invented income');
    expect(html).not.toContain('Import similar SMS automatically');
    expect(html).toMatch(/<button(?![^>]*disabled)(?=[^>]*value="approve")[^>]*>/);
  });

  it('explains when no active category can classify the SMS', () => {
    const { id } = createMessage(null);
    const html = renderForm(id, {
      categories: [
        { id: category.id, name: 'Invented groceries', kind: 'expense', archived: true },
      ],
    });
    expect(html).toContain('No spending category is available.');
    expect(html).toContain('href="/money/categories"');
    expect(html).not.toContain('Invented groceries');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
  });

  it('only offers Reject when the original message cannot be viewed', () => {
    const { id } = createMessage();
    const html = renderForm(id, { canReview: false });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*aria-keyshortcuts="R"[^>]*>/);
    expect(html).toContain('Reject SMS');
  });

  it('links to missing accounts and categories rather than presenting unusable controls', () => {
    const { id } = createMessage();
    const html = renderForm(id, { accounts: [], categories: [] });
    expect(html).toContain('href="/money/accounts"');
    expect(html).toContain('href="/money/categories"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*value="approve")[^>]*>/);
  });

  it('offers Skip only when there is another SMS to move to', () => {
    const { id } = createMessage();
    expect(renderForm(id)).not.toContain('aria-keyshortcuts="S"');
    expect(renderForm(id, { skipHref: '/money/sms?message=1' })).toMatch(
      /<a(?=[^>]*href="\/money\/sms\?message=1")(?=[^>]*aria-keyshortcuts="S")[^>]*>Skip<\/a>/,
    );
  });
});

describe('SMS review actions', () => {
  it('approves with edited values, learns a rule and erases the original SMS', async () => {
    const { id } = createMessage();
    expect(await reviewSmsFormAction(null, reviewData(id, 'learn'))).toEqual({
      ok: true,
      message: 'Transaction approved and rule learned',
    });
    const imported = stored(id);
    expect(imported).toMatchObject({ status: 'imported', rawCiphertext: null, decidedBy: 'owner' });
    expect(imported?.decidedAt).toBeTruthy();
    expect(pendingSmsMessage(id)).toBeNull();
    expect(
      db.select().from(transactions).where(eq(transactions.id, imported!.transactionId!)).get(),
    ).toMatchObject({
      date: '2026-10-08',
      amount: 9940,
      accountId: account.id,
      categoryId: category.id,
      description: 'Edited invented purchase',
    });
    const rule = db
      .select()
      .from(smsRules)
      .where(eq(smsRules.templateFingerprint, `invented-template-${sequence}`))
      .get();
    expect(rule).toMatchObject({ accountId: account.id, expenseCategoryId: category.id });
    expect(imported?.ruleId).toBe(rule?.id);
  });

  it('approves without learning and records the owner as the decider', async () => {
    const { id } = createMessage();
    expect(await reviewSmsFormAction(null, reviewData(id))).toEqual({
      ok: true,
      message: 'Transaction approved',
    });
    expect(stored(id)).toMatchObject({ status: 'imported', decidedBy: 'owner', ruleId: null });
  });

  it('reports failed validation and keeps the pending encrypted message', async () => {
    const { id } = createMessage();
    const invalid = reviewData(id);
    invalid.set('amount', '0');
    expect(await reviewSmsFormAction(null, invalid)).toMatchObject({
      ok: false,
      message: 'Enter an amount greater than zero.',
    });
    expect(pendingSmsMessage(id)?.body).toBeTruthy();
    expect(await reviewSmsFormAction(null, new FormData())).toMatchObject({
      ok: false,
      message: 'Choose how to review this SMS.',
    });
  });

  it('uses the chosen flow to approve an unclear SMS as spending', async () => {
    const { id } = createMessage(null);
    const form = reviewData(id);
    form.set('direction', 'expense');
    expect(await reviewSmsFormAction(null, form)).toMatchObject({ ok: true });
    const imported = stored(id);
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

  it('uses the chosen flow to approve an unclear SMS as income', async () => {
    const { id } = createMessage(null);
    const form = reviewData(id);
    form.set('direction', 'income');
    form.set('categoryId', String(incomeCategory.id));
    expect(await reviewSmsFormAction(null, form)).toMatchObject({ ok: true });
    const imported = stored(id);
    expect(imported).toMatchObject({ status: 'imported', direction: 'income' });
    expect(
      db.select().from(transactions).where(eq(transactions.id, imported!.transactionId!)).get(),
    ).toMatchObject({ type: 'income', categoryId: incomeCategory.id });
  });

  it('rejects a category that does not match the chosen flow', async () => {
    const { id } = createMessage(null);
    const form = reviewData(id);
    form.set('direction', 'income');
    expect(await reviewSmsFormAction(null, form)).toMatchObject({
      ok: false,
      message: 'Choose an income category.',
    });
    expect(pendingSmsMessage(id)?.body).toBeTruthy();
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

  it('blocks learning for unclear SMS, and Reject can be undone', async () => {
    const { id, rawBody } = createMessage(null);
    expect(await reviewSmsFormAction(null, reviewData(id, 'learn'))).toMatchObject({
      ok: false,
      message: 'The SMS direction is unclear. Choose a category and approve it manually instead.',
    });
    const rejectForm = new FormData();
    rejectForm.set('id', String(id));
    const rejected = await rejectSms(rejectForm);
    expect(rejected).toMatchObject({ ok: true, message: 'SMS rejected', count: 1 });
    expect(pendingSmsMessage(id)).toBeNull();
    expect(stored(id)).toMatchObject({
      status: 'rejected',
      rawCiphertext: null,
      decidedBy: 'owner',
    });

    if (!rejected.ok || !rejected.undo) throw new Error('Reject gave no undo token.');
    expect(await undoSmsReject(rejected.undo)).toEqual({ ok: true, message: 'SMS restored' });
    expect(pendingSmsMessage(id)).toMatchObject({ body: rawBody });
    expect(stored(id)).toMatchObject({ decidedBy: null, decidedAt: null });
    expect(await undoSmsReject(rejected.undo)).toMatchObject({ ok: false });
    expect(await rejectSms(rejectForm)).toMatchObject({ ok: true });
    expect(await rejectSms(rejectForm)).toMatchObject({
      ok: false,
      message: 'That SMS is no longer pending.',
    });
  });
});

describe('SMS bulk actions', () => {
  it('approves nothing when one selected SMS is not ready', async () => {
    const ready = createMessage();
    const wrong = createMessage();
    const result = await approveSmsBatch({
      items: [
        { id: ready.id, accountId: account.id, categoryId: category.id },
        { id: wrong.id, accountId: account.id, categoryId: incomeCategory.id },
      ],
      learn: false,
    });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toContain('needs a spending category. Open it to finish.');
    expect(stored(ready.id)?.status).toBe('pending');
    expect(stored(wrong.id)?.status).toBe('pending');
  });

  it('approves every ready SMS together and can teach their rules', async () => {
    const first = createMessage();
    const second = createMessage();
    const before = db.select().from(transactions).all().length;
    expect(
      await approveSmsBatch({
        items: [
          { id: first.id, accountId: account.id, categoryId: category.id },
          { id: second.id, accountId: account.id, categoryId: category.id },
        ],
        learn: true,
      }),
    ).toEqual({ ok: true, count: 2, message: '2 transactions approved and 2 rules learned' });
    expect(db.select().from(transactions).all()).toHaveLength(before + 2);
    for (const id of [first.id, second.id]) {
      expect(stored(id)).toMatchObject({
        status: 'imported',
        rawCiphertext: null,
        decidedBy: 'owner',
        proposedAccountId: account.id,
        proposedCategoryId: category.id,
      });
      expect(stored(id)?.ruleId).not.toBeNull();
    }
  });

  it('refuses an empty selection and SMS that are no longer pending', async () => {
    expect(await approveSmsBatch({ items: [], learn: false })).toMatchObject({ ok: false });
    const { id } = createMessage();
    await reviewSmsFormAction(null, reviewData(id));
    expect(
      await approveSmsBatch({
        items: [{ id, accountId: account.id, categoryId: category.id }],
        learn: false,
      }),
    ).toMatchObject({
      ok: false,
      message: 'Some of these SMS are no longer waiting for review. Refresh and try again.',
    });
  });

  it('rejects several SMS at once and restores them all with Undo', async () => {
    const ids = [createMessage().id, createMessage().id];
    const result = await rejectSmsBatch(ids);
    expect(result).toMatchObject({ ok: true, message: '2 SMS rejected', count: 2 });
    expect(db.select().from(smsMessages).where(inArray(smsMessages.id, ids)).all()).toSatisfy(
      (rows: { status: string }[]) => rows.every((row) => row.status === 'rejected'),
    );
    if (!result.ok || !result.undo) throw new Error('Bulk reject gave no undo token.');
    await undoSmsReject(result.undo);
    for (const id of ids) expect(pendingSmsMessage(id)?.body).toBeTruthy();
    expect(await rejectSmsBatch([])).toMatchObject({ ok: false });
  });
});

describe('SMS rules and history', () => {
  async function learnedRule() {
    const { id } = createMessage();
    await reviewSmsFormAction(null, reviewData(id, 'learn'));
    const message = stored(id)!;
    return { messageId: id, ruleId: message.ruleId! };
  }

  it('counts what each rule imported and when it last did', async () => {
    const { ruleId } = await learnedRule();
    expect(smsRuleRows().find((rule) => rule.id === ruleId)).toMatchObject({
      imported: 1,
      lastUsed: expect.any(String),
    });
  });

  it('imports the next similar SMS through the learned rule until the rule is turned off', async () => {
    const requested = await requestSmsDevicePairing({ label: 'Invented rule phone' });
    if (!requested.ok) throw new Error('The invented request failed.');
    const approve = new FormData();
    approve.set('id', String(requested.deviceId));
    approve.set('intent', 'approve');
    await manageSmsDeviceFormAction(null, approve);
    const claimed = await claimSmsDeviceToken(requested.claimToken);
    if (!claimed.ok || claimed.status !== 'approved') throw new Error('The invented claim failed.');
    const send = (messageId: string, body: string) =>
      receiveSms(claimed.token, {
        schemaVersion: 1,
        messageId,
        sender: 'DEMO-SHOPBK',
        receivedAt: '2026-10-09T10:00:00+05:30',
        body,
      });

    const first = await send(
      'rule-1',
      'INR 450.00 debited on 09/10/2026 at Demo Mart. Ref UPI AAA11111',
    );
    expect(first).toMatchObject({ ok: true, status: 'queued' });
    if (!first.ok) return;
    await reviewSmsFormAction(null, reviewData(first.id, 'learn'));
    const ruleId = stored(first.id)!.ruleId!;
    expect(ruleId).toBeTruthy();

    const second = await send(
      'rule-2',
      'INR 99.00 debited on 10/10/2026 at Demo Mart. Ref UPI BBB22222',
    );
    expect(second).toMatchObject({ ok: true, status: 'imported' });
    if (!second.ok) return;
    expect(stored(second.id)).toMatchObject({ ruleId, decidedBy: 'rule', rawCiphertext: null });
    expect(stored(second.id)?.decidedAt).toBeTruthy();
    expect(smsRuleRows().find((rule) => rule.id === ruleId)?.imported).toBe(2);

    await setSmsRuleEnabled(ruleId, false);
    const third = await send(
      'rule-3',
      'INR 12.00 debited on 11/10/2026 at Demo Mart. Ref UPI CCC33333',
    );
    expect(third).toMatchObject({ ok: true, status: 'queued' });
    if (!third.ok) return;
    expect(stored(third.id)).toMatchObject({ status: 'pending', ruleId: null, decidedBy: null });
  });

  it('turns a rule off and on', async () => {
    const { ruleId } = await learnedRule();
    expect(await setSmsRuleEnabled(ruleId, false)).toEqual({
      ok: true,
      message: 'Rule turned off',
    });
    expect(smsRuleRows().find((rule) => rule.id === ruleId)?.enabled).toBe(0);
    expect(await setSmsRuleEnabled(ruleId, true)).toEqual({ ok: true, message: 'Rule turned on' });
    expect(await setSmsRuleEnabled(999999, true)).toMatchObject({ ok: false });
  });

  it('edits where a rule sends its SMS and checks each category kind', async () => {
    const { ruleId } = await learnedRule();
    const form = new FormData();
    form.set('id', String(ruleId));
    form.set('name', 'Invented shop rule');
    form.set('accountId', String(account.id));
    form.set('incomeCategoryId', '');
    form.set('expenseCategoryId', '');
    expect(await updateSmsRule(form)).toMatchObject({
      ok: false,
      message: 'Choose a category for money in, money out or both.',
    });
    form.set('expenseCategoryId', String(incomeCategory.id));
    expect(await updateSmsRule(form)).toMatchObject({
      ok: false,
      fieldErrors: { expenseCategoryId: 'Choose a spending category.' },
    });
    form.set('expenseCategoryId', String(category.id));
    form.set('incomeCategoryId', String(incomeCategory.id));
    expect(await updateSmsRule(form)).toEqual({ ok: true, message: 'Rule saved' });
    expect(db.select().from(smsRules).where(eq(smsRules.id, ruleId)).get()).toMatchObject({
      name: 'Invented shop rule',
      incomeCategoryId: incomeCategory.id,
      expenseCategoryId: category.id,
    });
  });

  it('deletes a rule and puts it and its history links back with Undo', async () => {
    const { messageId, ruleId } = await learnedRule();
    const deleted = await deleteSmsRule(ruleId);
    expect(deleted).toMatchObject({ ok: true, message: 'Rule deleted' });
    expect(db.select().from(smsRules).where(eq(smsRules.id, ruleId)).get()).toBeUndefined();
    expect(stored(messageId)?.ruleId).toBeNull();
    if (!deleted.ok || !deleted.undo) throw new Error('Delete gave no undo token.');
    expect(await undoSmsRuleDelete(deleted.undo)).toEqual({ ok: true, message: 'Rule restored' });
    expect(stored(messageId)?.ruleId).toBe(ruleId);
    expect(await deleteSmsRule(999999)).toMatchObject({ ok: false });
  });

  it('lists decided SMS for an India-time month with how each was decided', async () => {
    const approved = createMessage();
    await reviewSmsFormAction(null, reviewData(approved.id));
    const rejected = createMessage();
    const rejectForm = new FormData();
    rejectForm.set('id', String(rejected.id));
    await rejectSms(rejectForm);
    const automatic = (receivedAt: string) =>
      db
        .insert(smsMessages)
        .values({
          deviceId: device.id,
          sender: 'DEMO-ALERT',
          receivedAt,
          contentHash: `invented-content-auto-${++sequence}`,
          status: 'imported',
          parserVersion: '1',
          amount: 5000,
          direction: 'expense',
          decidedBy: 'rule',
        })
        .returning({ id: smsMessages.id })
        .get().id;
    const lateOctober = automatic('2026-10-31T23:30:00+05:30');
    // 19:30 UTC on 31 October is already 1 am on 1 November in India.
    const earlyNovember = automatic('2026-10-31T19:30:00Z');
    const october = smsHistory({ month: '2026-10' });
    const november = smsHistory({ month: '2026-11' });
    const outcome = (id: number) => october.find((row) => row.id === id)?.outcome;
    expect(outcome(approved.id)).toBe('approved');
    expect(outcome(rejected.id)).toBe('rejected');
    expect(outcome(lateOctober)).toBe('auto');
    expect(october.find((row) => row.id === approved.id)).toMatchObject({
      description: 'Edited invented purchase',
    });
    expect(november.some((row) => row.id === lateOctober)).toBe(false);
    expect(october.some((row) => row.id === earlyNovember)).toBe(false);
    expect(november.find((row) => row.id === earlyNovember)?.outcome).toBe('auto');
    expect(october.some((row) => pendingSmsMessage(row.id))).toBe(false);
  });
});

describe('SMS phones', () => {
  it('approves and revokes a phone with plain messages', async () => {
    const requested = await requestSmsDevicePairing({ label: 'Invented second phone' });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(pendingSmsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(true);
    const form = new FormData();
    form.set('id', String(requested.deviceId));
    form.set('intent', 'approve');
    expect(await manageSmsDeviceFormAction(null, form)).toEqual({
      ok: true,
      message: 'Phone approved',
    });
    expect(pendingSmsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(false);
    expect(smsDeviceRows().find((item) => item.id === requested.deviceId)).toMatchObject({
      receivedThisWeek: 0,
    });
    expect(await manageSmsDeviceFormAction(null, form)).toMatchObject({ ok: false });
    form.set('intent', 'revoke');
    expect(await manageSmsDeviceFormAction(null, form)).toEqual({
      ok: true,
      message: 'Phone revoked',
    });
    expect(
      smsDeviceRows().find((item) => item.id === requested.deviceId)?.revokedAt,
    ).not.toBeNull();
  });

  it('rejects a phone request', async () => {
    const requested = await requestSmsDevicePairing({ label: 'Invented third phone' });
    if (!requested.ok) throw new Error('The invented request failed.');
    const form = new FormData();
    form.set('id', String(requested.deviceId));
    form.set('intent', 'reject');
    expect(await manageSmsDeviceFormAction(null, form)).toEqual({
      ok: true,
      message: 'Request rejected',
    });
    expect(pendingSmsDeviceRows().some((item) => item.id === requested.deviceId)).toBe(false);
  });

  it('counts SMS each phone sent in the last week', () => {
    const before = smsDeviceRows().find((item) => item.id === device.id)!.receivedThisWeek;
    createMessage();
    expect(smsDeviceRows().find((item) => item.id === device.id)?.receivedThisWeek).toBe(
      before + 1,
    );
  });
});
