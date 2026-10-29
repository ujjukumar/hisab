import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-v2-'));
process.env.DATABASE_PATH = join(directory, 'v2.db');
const KEY = randomBytes(32).toString('base64');
process.env.SMS_ENCRYPTION_KEY = KEY;
process.env.SMS_PAIRING_URL = 'https://hisaab-pc.example-tailnet.ts.net/';

const { createSmsPairingInvite, redeemSmsPairingInvite, revokeSmsDevice } =
  await import('@/lib/actions/sms');
const batchRoute = await import('@/app/api/sms/v2/batch/route');
const statusRoute = await import('@/app/api/sms/v2/status/route');
const inboundRoute = await import('@/app/api/sms/inbound/route');
const { sqlite } = await import('@/lib/db/client');

afterAll(() => {
  delete process.env.SMS_PAIRING_URL;
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

const fixtures = fileURLToPath(new URL('./fixtures/sms-v2/', import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are plain JSON
const fixture = (name: string): any => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

type ErrorFixture = { http: number; body: { ok: false; code: string; message: string } };
const errors = fixture('errors.json') as ErrorFixture[];

async function expectError(response: Response, code: string) {
  const expected = errors.find((error) => error.body.code === code);
  if (!expected) throw new Error(`No fixture for ${code}`);
  expect(response.status).toBe(expected.http);
  expect(await response.json()).toEqual(expected.body);
}

async function pair(installationId: string, label = 'Invented phone') {
  const invite = await createSmsPairingInvite();
  if (!invite.ok) throw new Error(invite.message);
  const secret = new URL(invite.link).searchParams.get('secret') ?? '';
  const result = await redeemSmsPairingInvite({ secret, label, installationId });
  if (!result.ok) throw new Error(result.message);
  return result;
}

const auth = (token: string | null): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

const post = (token: string | null, body: unknown, headers: Record<string, string> = {}) =>
  batchRoute.POST(
    new Request('http://127.0.0.1/api/sms/v2/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(token), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const status = (token: string | null) =>
  statusRoute.GET(new Request('http://127.0.0.1/api/sms/v2/status', { headers: auth(token) }));

const message = (messageId: string, overrides: Record<string, unknown> = {}) => ({
  messageId,
  sender: 'VM-INVBNK-S',
  receivedAt: '2026-10-30T10:42:05+05:30',
  body: `INR 1.00 debited from a/c XX0000. Ref ${messageId}`,
  source: 'live',
  ...overrides,
});

const batch = (installationId: string, messages: unknown[]) => ({
  schemaVersion: 2,
  installationId,
  messages,
});

const statuses = async (response: Response) => {
  expect(response.status).toBe(200);
  const json = (await response.json()) as { results: { status: string }[] };
  return json.results.map((result) => result.status);
};

describe('SMS protocol v2 fixtures', () => {
  // Runs first, on an empty database, so the IDs in the fixtures line up.
  it('answers the shared fixtures exactly', async () => {
    const request = fixture('batch-request.json');
    const paired = await pair(request.installationId);

    const first = await post(paired.token, request);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(fixture('batch-response.json'));

    const again = await post(paired.token, request);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(fixture('batch-response-resent.json'));

    const checked = await status(paired.token);
    expect(checked.status).toBe(200);
    expect(await checked.json()).toEqual({
      ...fixture('status-response.json'),
      serverTime: expect.any(String),
      lastReceivedAt: expect.any(String),
    });
  });
});

describe('GET /api/sms/v2/status', () => {
  it('needs a token', async () => {
    await expectError(await status(null), 'token_missing');
  });

  it('says when the token is unknown', async () => {
    await expectError(await status(randomBytes(32).toString('base64url')), 'token_unknown');
  });

  it('says when the phone was revoked, for status and batch', async () => {
    const paired = await pair('invented-installation-revoked');
    const form = new FormData();
    form.set('id', String(paired.deviceId));
    expect(await revokeSmsDevice(form)).toEqual({ ok: true });
    await expectError(await status(paired.token), 'device_revoked');
    await expectError(
      await post(paired.token, batch('invented-installation-revoked', [message('r-1')])),
      'device_revoked',
    );
  });

  it('reports the device and its totals', async () => {
    const paired = await pair('invented-installation-status', 'Status phone');
    await post(
      paired.token,
      batch('invented-installation-status', [message('s-1'), message('s-2')]),
    );
    const response = await status(paired.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      configured: true,
      device: { id: paired.deviceId, label: 'Status phone' },
      acceptedTotal: 2,
      lastReceivedAt: expect.any(String),
    });
  });
});

describe('POST /api/sms/v2/batch', () => {
  it('needs a token, then a known one', async () => {
    await expectError(await post(null, batch('x', [message('a')])), 'token_missing');
    await expectError(
      await post(randomBytes(32).toString('base64url'), batch('x', [message('a')])),
      'token_unknown',
    );
  });

  it('refuses a token from another installation', async () => {
    const paired = await pair('invented-installation-a');
    await expectError(
      await post(paired.token, batch('invented-installation-b', [message('m-1')])),
      'installation_mismatch',
    );
  });

  it('answers 400 for bad JSON or a malformed batch', async () => {
    const paired = await pair('invented-installation-malformed');
    const id = 'invented-installation-malformed';
    await expectError(await post(paired.token, '{not json'), 'invalid_json');
    await expectError(
      await post(paired.token, { ...batch(id, [message('m-1')]), schemaVersion: 1 }),
      'invalid_batch',
    );
    await expectError(await post(paired.token, batch(id, [])), 'invalid_batch');
    await expectError(
      await post(
        paired.token,
        batch(
          id,
          Array.from({ length: 51 }, (_, i) => message(`m-${i}`)),
        ),
      ),
      'invalid_batch',
    );
    await expectError(
      await post(paired.token, batch(id, [{ ...message('m-1'), messageId: '' }])),
      'invalid_batch',
    );
  });

  it('answers 413 over 256 KB, by header or by actual size', async () => {
    const paired = await pair('invented-installation-large');
    await expectError(
      await post(paired.token, batch('invented-installation-large', [message('m-1')]), {
        'content-length': String(300 * 1024),
      }),
      'too_large',
    );
    const huge = batch(
      'invented-installation-large',
      Array.from({ length: 50 }, (_, i) => message(`m-${i}`, { body: 'x'.repeat(6000) })),
    );
    await expectError(await post(paired.token, huge), 'too_large');
  });

  it('rejects bad messages one by one and keeps the rest', async () => {
    const paired = await pair('invented-installation-mixed');
    const response = await post(
      paired.token,
      batch('invented-installation-mixed', [
        message('x-1'),
        message('x-2', { body: 'y'.repeat(4097) }),
        message('x-3', { sender: '' }),
        message('x-4', { source: 'carrier pigeon' }),
        message('x-5'),
      ]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      results: [
        { messageId: 'x-1', status: 'accepted', imported: false },
        { messageId: 'x-2', status: 'rejected', code: 'too_large' },
        { messageId: 'x-3', status: 'rejected', code: 'invalid' },
        { messageId: 'x-4', status: 'rejected', code: 'invalid' },
        { messageId: 'x-5', status: 'accepted' },
      ],
    });
  });

  it('treats a repeat inside one batch as a duplicate', async () => {
    const paired = await pair('invented-installation-repeat');
    const response = await post(
      paired.token,
      batch('invented-installation-repeat', [message('d-1'), message('d-1')]),
    );
    expect(await statuses(response)).toEqual(['accepted', 'duplicate']);
  });

  it('recognises messages sent before a re-pair', async () => {
    const id = 'invented-installation-repair';
    const first = await pair(id);
    expect(await statuses(await post(first.token, batch(id, [message('p-1')])))).toEqual([
      'accepted',
    ]);

    const second = await pair(id);
    await expectError(await post(first.token, batch(id, [message('p-2')])), 'device_revoked');
    const resent = await post(
      second.token,
      batch(id, [
        // Same provider ID.
        message('p-1'),
        // New ID (for example after a restore), same sender, text and time.
        message('p-1-restored', { body: 'INR 1.00 debited from a/c XX0000. Ref p-1' }),
        // Same text at another time is a new message.
        message('p-1-later', {
          body: 'INR 1.00 debited from a/c XX0000. Ref p-1',
          receivedAt: '2026-10-30T11:42:05+05:30',
        }),
        // Same instant written in another offset is still the same message.
        message('p-1-utc', {
          body: 'INR 1.00 debited from a/c XX0000. Ref p-1',
          receivedAt: '2026-10-30T05:12:05Z',
        }),
      ]),
    );
    expect(await statuses(resent)).toEqual(['duplicate', 'duplicate', 'accepted', 'duplicate']);

    const checked = await status(second.token);
    expect(await checked.json()).toMatchObject({ acceptedTotal: 2 });
  });

  it('keeps other phones’ messages apart', async () => {
    const one = await pair('invented-installation-one');
    const two = await pair('invented-installation-two');
    expect(
      await statuses(
        await post(one.token, batch('invented-installation-one', [message('shared-1')])),
      ),
    ).toEqual(['accepted']);
    expect(
      await statuses(
        await post(two.token, batch('invented-installation-two', [message('shared-1')])),
      ),
    ).toEqual(['accepted']);
  });
});

describe('a server without SMS_ENCRYPTION_KEY', () => {
  it('answers 503 so the phone keeps its messages, and says so in status', async () => {
    const paired = await pair('invented-installation-unconfigured');
    delete process.env.SMS_ENCRYPTION_KEY;
    try {
      await expectError(
        await post(paired.token, batch('invented-installation-unconfigured', [message('u-1')])),
        'server_not_configured',
      );
      const checked = await status(paired.token);
      expect(checked.status).toBe(200);
      expect(await checked.json()).toMatchObject({ ok: true, configured: false });

      const v1 = await inboundRoute.POST(
        new Request('http://127.0.0.1/api/sms/inbound', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth(paired.token) },
          body: JSON.stringify({ schemaVersion: 1, ...message('u-2'), source: undefined }),
        }),
      );
      expect(v1.status).toBe(503);
      expect(await v1.json()).toMatchObject({ ok: false, code: 'server_not_configured' });
    } finally {
      process.env.SMS_ENCRYPTION_KEY = KEY;
    }
  });
});

describe('POST /api/sms/inbound (v1) still works', () => {
  it('queues a message and reports a repeat as a duplicate', async () => {
    const paired = await pair('invented-installation-v1');
    const send = () =>
      inboundRoute.POST(
        new Request('http://127.0.0.1/api/sms/inbound', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth(paired.token) },
          body: JSON.stringify({
            schemaVersion: 1,
            messageId: 'v1-1',
            sender: 'VM-INVBNK-S',
            receivedAt: '2026-10-30T10:42:05+05:30',
            body: 'INR 1.00 debited from a/c XX0000. Ref v1-1',
            installationId: 'invented-installation-v1',
          }),
        }),
      );
    const first = await send();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, status: 'queued' });
    const again = await send();
    expect(await again.json()).toMatchObject({ ok: true, status: 'duplicate' });
  });
});
