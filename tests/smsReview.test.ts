import { describe, expect, it } from 'vitest';
import {
  formatReceived,
  formatReceivedFull,
  highlightSegments,
  istDate,
  parseQueueFilter,
  parseQueueSort,
  senderLabel,
  smsConnectionSummary,
  smsDeviceStatus,
  smsMissingText,
  smsNeighbours,
  smsQueueKind,
  smsQueueView,
  smsReadiness,
  smsReasons,
  smsReviewHref,
  smsSuggestion,
  type ReadinessInput,
  type SmsApproval,
} from '@/lib/domain/smsReview';

const choices = {
  accounts: [
    { id: 1, archived: false },
    { id: 2, archived: true },
  ],
  categories: [
    { id: 10, kind: 'expense' as const, archived: false },
    { id: 11, kind: 'income' as const, archived: false },
    { id: 12, kind: 'expense' as const, archived: true },
  ],
};

describe('smsQueueKind and queue parameters', () => {
  it('sorts each pending SMS under one filter chip', () => {
    expect(smsQueueKind({ direction: 'expense', amount: 100 })).toBe('out');
    expect(smsQueueKind({ direction: 'income', amount: null })).toBe('in');
    expect(smsQueueKind({ direction: null, amount: 100 })).toBe('unclear');
    expect(smsQueueKind({ direction: null, amount: 0 })).toBe('unclear');
    expect(smsQueueKind({ direction: null, amount: null })).toBe('other');
  });

  it('falls back to the defaults for unknown filter and sort values', () => {
    expect(parseQueueFilter('unclear')).toBe('unclear');
    expect(parseQueueFilter('everything')).toBe('all');
    expect(parseQueueFilter(undefined)).toBe('all');
    expect(parseQueueSort('amount')).toBe('amount');
    expect(parseQueueSort(['old'])).toBe('new');
  });
});

describe('smsQueueView', () => {
  const rows = [
    { id: 1, receivedAt: '2026-10-07T08:00:00+05:30', direction: 'expense' as const, amount: 5000 },
    { id: 2, receivedAt: '2026-10-08T08:00:00+05:30', direction: 'income' as const, amount: 90000 },
    { id: 3, receivedAt: '2026-10-08T08:00:00+05:30', direction: null, amount: 5000 },
    { id: 4, receivedAt: '2026-10-06T08:00:00+05:30', direction: null, amount: null },
  ];

  it('counts every chip from the whole queue, whatever the filter', () => {
    const view = smsQueueView(rows, 'in', 'new');
    expect(view.counts).toEqual({ all: 4, out: 1, in: 1, unclear: 1, other: 1 });
    expect(view.rows.map((row) => row.id)).toEqual([2]);
  });

  it('puts the newest first and breaks time ties by the later id', () => {
    expect(smsQueueView(rows, 'all', 'new').rows.map((row) => row.id)).toEqual([3, 2, 1, 4]);
    expect(smsQueueView(rows, 'all', 'old').rows.map((row) => row.id)).toEqual([4, 1, 2, 3]);
  });

  it('puts the largest amount first and SMS without an amount last', () => {
    expect(smsQueueView(rows, 'all', 'amount').rows.map((row) => row.id)).toEqual([2, 3, 1, 4]);
  });

  it('handles an empty queue and does not change the input order', () => {
    expect(smsQueueView([], 'all', 'new')).toEqual({
      rows: [],
      counts: { all: 0, out: 0, in: 0, unclear: 0, other: 0 },
    });
    smsQueueView(rows, 'all', 'old');
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('smsNeighbours', () => {
  it('moves to the next SMS after a decision, or back when it was the last', () => {
    expect(smsNeighbours([5, 6, 7], 6)).toEqual({
      index: 1,
      total: 3,
      prev: 5,
      next: 7,
      after: 7,
      skip: 7,
    });
    expect(smsNeighbours([5, 6, 7], 7)).toMatchObject({ prev: 6, next: null, after: 6, skip: 5 });
    expect(smsNeighbours([5, 6, 7], 5)).toMatchObject({ prev: null, next: 6, after: 6, skip: 6 });
  });

  it('has nowhere to go for the only SMS', () => {
    expect(smsNeighbours([5], 5)).toEqual({
      index: 0,
      total: 1,
      prev: null,
      next: null,
      after: null,
      skip: null,
    });
  });

  it('starts at the top when nothing or a missing SMS is open', () => {
    expect(smsNeighbours([5, 6], null)).toMatchObject({ index: -1, after: 5, skip: 5 });
    expect(smsNeighbours([5, 6], 99)).toMatchObject({ index: -1, after: 5 });
    expect(smsNeighbours([], null)).toMatchObject({ total: 0, after: null, skip: null });
  });
});

describe('smsReviewHref', () => {
  it('keeps defaults out of the URL', () => {
    expect(smsReviewHref({ filter: 'all', sort: 'new' })).toBe('/money/sms');
    expect(smsReviewHref({ message: null, filter: 'all', sort: 'new' })).toBe('/money/sms');
  });

  it('keeps the open SMS, filter and sort', () => {
    expect(smsReviewHref({ message: 12, filter: 'unclear', sort: 'amount' })).toBe(
      '/money/sms?message=12&filter=unclear&sort=amount',
    );
    expect(smsReviewHref({ message: 3, filter: 'all', sort: 'old' })).toBe(
      '/money/sms?message=3&sort=old',
    );
  });
});

describe('received times in India time', () => {
  it('turns any offset into the India calendar date', () => {
    expect(istDate('2026-10-31T18:29:59Z')).toBe('2026-10-31');
    expect(istDate('2026-10-31T18:30:00Z')).toBe('2026-11-01');
    expect(istDate('2026-12-31T19:00:00Z')).toBe('2027-01-01');
    expect(istDate('2028-02-28T19:00:00Z')).toBe('2028-02-29');
    expect(istDate('2026-10-07T23:59:00+05:30')).toBe('2026-10-07');
    expect(istDate(new Date('2026-10-07T00:00:00Z'))).toBe('2026-10-07');
  });

  it('returns null for an unreadable time', () => {
    expect(istDate('not a time')).toBeNull();
    expect(formatReceived('not a time', '2026-10-07T08:00:00Z')).toBe('');
    expect(formatReceivedFull('')).toBe('');
  });

  it('says today and yesterday by the India date, not the computer’s', () => {
    const now = '2026-10-11T04:00:00Z'; // 9:30 am on 11 Oct in India
    expect(formatReceived('2026-10-11T00:05:00+05:30', now)).toBe('Today 12:05 am');
    expect(formatReceived('2026-10-10T18:40:00Z', now)).toBe('Today 12:10 am');
    expect(formatReceived('2026-10-10T18:00:00+05:30', now)).toBe('Yesterday 6:00 pm');
    expect(formatReceived('2026-10-09T12:00:00+05:30', now)).toBe('9 Oct');
    expect(formatReceived('2025-10-09T12:00:00+05:30', now)).toBe('9 Oct 2025');
  });

  it('counts the last day of the year as yesterday on New Year’s Day', () => {
    const now = '2027-01-01T03:00:00+05:30';
    expect(formatReceived('2026-12-31T23:00:00+05:30', now)).toBe('Yesterday 11:00 pm');
    expect(formatReceived('2026-12-30T23:00:00+05:30', now)).toBe('30 Dec 2026');
  });

  it('writes the full date with the time for the open SMS', () => {
    expect(formatReceivedFull('2026-10-11T09:42:00+05:30')).toBe('11 Oct 2026, 9:42 am');
    expect(formatReceivedFull('2028-02-29T12:00:00+05:30')).toBe('29 Feb 2028, 12:00 pm');
  });
});

describe('smsReadiness and smsMissingText', () => {
  const ready: ReadinessInput = {
    direction: 'expense',
    amount: 125050,
    transactionDate: '2026-10-07',
    accountId: 1,
    categoryId: 10,
  };

  it('is ready when nothing else is needed from the owner', () => {
    expect(smsReadiness(ready, choices)).toEqual({ ready: true, missing: [] });
  });

  it('lists everything still missing', () => {
    expect(
      smsReadiness(
        { direction: null, amount: null, transactionDate: null, accountId: null, categoryId: null },
        choices,
      ),
    ).toEqual({
      ready: false,
      missing: ['direction', 'amount', 'date', 'account', 'category'],
    });
  });

  it('treats a zero amount and an impossible date as missing', () => {
    expect(smsReadiness({ ...ready, amount: 0 }, choices).missing).toEqual(['amount']);
    expect(smsReadiness({ ...ready, transactionDate: '2026-02-29' }, choices).missing).toEqual([
      'date',
    ]);
    expect(smsReadiness({ ...ready, transactionDate: '2028-02-29' }, choices).ready).toBe(true);
  });

  it('does not accept archived choices or a category of the other kind', () => {
    expect(smsReadiness({ ...ready, accountId: 2 }, choices).missing).toEqual(['account']);
    expect(smsReadiness({ ...ready, categoryId: 12 }, choices).missing).toEqual(['category']);
    expect(smsReadiness({ ...ready, categoryId: 11 }, choices).missing).toEqual(['category']);
    expect(smsReadiness({ ...ready, accountId: 99 }, choices).missing).toEqual(['account']);
  });

  it('writes what to choose as one plain sentence', () => {
    expect(smsMissingText([])).toBe('');
    expect(smsMissingText(['category'])).toBe('Choose a category.');
    expect(smsMissingText(['account', 'category'])).toBe('Choose an account and a category.');
    expect(smsMissingText(['direction', 'account', 'category'])).toBe(
      'Choose money in or out, an account and a category.',
    );
  });
});

describe('smsSuggestion', () => {
  const message = { senderPattern: '^DEMO-BANK$', direction: 'expense' as const };
  const past = (over: Partial<SmsApproval>): SmsApproval => ({
    senderPattern: '^DEMO-BANK$',
    direction: 'expense',
    accountId: 1,
    categoryId: 10,
    ...over,
  });

  it('suggests the newest choice for the same sender and flow', () => {
    expect(smsSuggestion([past({}), past({ accountId: 2 })], message, choices)).toEqual({
      accountId: 1,
      categoryId: 10,
    });
  });

  it('skips archived choices and categories of the other kind', () => {
    expect(
      smsSuggestion(
        [past({ categoryId: 12 }), past({ accountId: 2 }), past({ categoryId: 11 }), past({})],
        message,
        choices,
      ),
    ).toEqual({ accountId: 1, categoryId: 10 });
    expect(smsSuggestion([past({ categoryId: 12 })], message, choices)).toBeNull();
  });

  it('ignores other senders and other flows', () => {
    expect(
      smsSuggestion(
        [past({ senderPattern: '^OTHER$' }), past({ direction: 'income', categoryId: 11 })],
        message,
        choices,
      ),
    ).toBeNull();
  });

  it('has no suggestion without a sender pattern or a flow', () => {
    expect(smsSuggestion([past({})], { ...message, senderPattern: null }, choices)).toBeNull();
    expect(smsSuggestion([past({})], { ...message, direction: null }, choices)).toBeNull();
    expect(smsSuggestion([], message, choices)).toBeNull();
  });
});

describe('phone status', () => {
  const phone = {
    label: 'Invented phone',
    approvedAt: '2026-10-01T00:00:00Z',
    claimedAt: null as string | null,
    lastSeenAt: null as string | null,
    revokedAt: null as string | null,
  };
  const now = '2026-10-11T06:00:00Z';

  it('names each phone state', () => {
    expect(smsDeviceStatus(phone)).toEqual({ state: 'waiting', label: 'Waiting for phone' });
    expect(smsDeviceStatus({ ...phone, claimedAt: now })).toEqual({
      state: 'no-sms',
      label: 'Connected, no SMS yet',
    });
    expect(smsDeviceStatus({ ...phone, claimedAt: now, lastSeenAt: now }).state).toBe('connected');
    expect(smsDeviceStatus({ ...phone, lastSeenAt: now, revokedAt: now }).state).toBe('revoked');
  });

  it('summarises the connection under the heading', () => {
    expect(smsConnectionSummary([], now)).toEqual({ text: 'No phone paired', connected: false });
    expect(smsConnectionSummary([{ ...phone, revokedAt: now }], now)).toEqual({
      text: 'No phone paired',
      connected: false,
    });
    expect(smsConnectionSummary([phone], now)).toEqual({
      text: 'Invented phone: waiting for phone',
      connected: false,
    });
    expect(smsConnectionSummary([phone, { ...phone, label: 'Second' }], now).text).toBe(
      '2 phones waiting to connect',
    );
    expect(smsConnectionSummary([{ ...phone, claimedAt: now }], now)).toEqual({
      text: 'Invented phone connected · no SMS yet',
      connected: true,
    });
    expect(smsConnectionSummary([{ ...phone, lastSeenAt: '2026-10-11T04:35:00Z' }], now)).toEqual({
      text: 'Invented phone connected · last SMS today 10:05 am',
      connected: true,
    });
  });

  it('uses the latest SMS from any connected phone', () => {
    const summary = smsConnectionSummary(
      [
        { ...phone, lastSeenAt: '2026-10-09T04:35:00Z' },
        { ...phone, label: 'Second', lastSeenAt: '2026-10-10T12:30:00Z' },
      ],
      now,
    );
    expect(summary.text).toBe('2 phones connected · last SMS yesterday 6:00 pm');
  });
});

describe('smsReasons', () => {
  const keys = (reason: string | null) => smsReasons(reason).map((r) => r.key);

  it('has nothing to say without a stored reason', () => {
    expect(smsReasons(null)).toEqual([]);
    expect(smsReasons('')).toEqual([]);
    expect(smsReasons('   ')).toEqual([]);
  });

  it('turns the parser’s sentences into plain words, most useful first', () => {
    const reasons = smsReasons(
      'No enabled provider rule matches this sender. The message does not contain one unambiguous INR amount. The message does not clearly say debit or credit.',
    );
    expect(reasons.map((r) => r.key)).toEqual(['direction', 'amount', 'rule']);
    expect(reasons.map((r) => r.short)).toEqual([
      'Money in or out unclear',
      'Amount unclear',
      'No matching rule yet',
    ]);
    expect(reasons[2]!.long).toBe('No rule matches this sender and wording yet.');
  });

  it('only mentions a missing category when a rule did match', () => {
    expect(
      keys(
        'No enabled provider rule matches this sender. No category is configured for this direction.',
      ),
    ).toEqual(['rule']);
    expect(keys('No category is configured for this direction.')).toEqual(['category']);
    expect(keys('The configured account or category no longer exists.')).toEqual(['stale']);
    expect(keys('The message does not contain a valid transaction date.')).toEqual(['date']);
  });

  it('keeps any text it does not recognise', () => {
    expect(
      smsReasons('The SMS body is empty.  The message does not clearly say debit or credit.'),
    ).toEqual([
      {
        key: 'direction',
        short: 'Money in or out unclear',
        long: "It doesn't say whether money came in or went out.",
      },
      { key: 'other', short: 'The SMS body is empty.', long: 'The SMS body is empty.' },
    ]);
    expect(smsReasons('Check the account and category.')).toEqual([
      {
        key: 'other',
        short: 'Check the account and category.',
        long: 'Check the account and category.',
      },
    ]);
  });
});

describe('senderLabel', () => {
  it('shows an exact learned pattern as the sender it matches', () => {
    expect(senderLabel('^AX\\-DEMOBK\\-S$')).toBe('AX-DEMOBK-S');
    expect(senderLabel('^DEMO$')).toBe('DEMO');
  });

  it('leaves any other pattern as written', () => {
    expect(senderLabel('^BANK-')).toBe('^BANK-');
    expect(senderLabel('')).toBe('');
  });
});

describe('highlightSegments', () => {
  it('returns the whole text when nothing is highlighted', () => {
    expect(highlightSegments('Plain text', [])).toEqual([{ text: 'Plain text', kind: null }]);
    expect(highlightSegments('', [])).toEqual([]);
  });

  it('cuts plain and highlighted pieces in order', () => {
    expect(
      highlightSegments('INR 50 debited', [
        { start: 0, end: 6, kind: 'amount' },
        { start: 7, end: 14, kind: 'direction' },
      ]),
    ).toEqual([
      { text: 'INR 50', kind: 'amount' },
      { text: ' ', kind: null },
      { text: 'debited', kind: 'direction' },
    ]);
  });

  it('skips overlapping, empty and out-of-range parts instead of repeating text', () => {
    expect(
      highlightSegments('abcdef', [
        { start: 1, end: 3, kind: 'a' },
        { start: 2, end: 4, kind: 'b' },
        { start: 4, end: 4, kind: 'c' },
        { start: 5, end: 50, kind: 'd' },
        { start: 60, end: 70, kind: 'e' },
      ]),
    ).toEqual([
      { text: 'a', kind: null },
      { text: 'bc', kind: 'a' },
      { text: 'd', kind: 'b' },
      { text: 'e', kind: null },
      { text: 'f', kind: 'd' },
    ]);
  });
});
