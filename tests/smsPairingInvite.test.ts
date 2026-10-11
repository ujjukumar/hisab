import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-invites-'));
process.env.DATABASE_PATH = join(directory, 'invites.db');
process.env.SMS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const PAIRING_URL = 'https://hisaab-pc.example-tailnet.ts.net/';
const NOW = new Date('2026-10-11T09:00:00.000Z');
const EXPIRED = 'This pairing code expired or was already used. Show a new code in Hisaab.';

const { createSmsPairingInvite, receiveSms, redeemSmsPairingInvite, revokeSmsDevice } =
  await import('@/lib/actions/sms');
const { POST } = await import('@/app/api/sms/pair/redeem/route');
const { smsDeviceRows } = await import('@/lib/queries/sms');
const { hashSmsToken } = await import('@/lib/sms/security');
const { sqlite } = await import('@/lib/db/client');

beforeEach(() => {
  process.env.SMS_PAIRING_URL = PAIRING_URL;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.SMS_PAIRING_URL;
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

const invite = async () => {
  const result = await createSmsPairingInvite();
  if (!result.ok) throw new Error(result.message);
  const secret = new URL(result.link).searchParams.get('secret') ?? '';
  return { ...result, secret };
};

const redeem = async (secret: string, label = 'Invented phone') => {
  const result = await redeemSmsPairingInvite({ secret, label });
  if (!result.ok) throw new Error(result.message);
  return result;
};

const idForm = (id: number) => {
  const form = new FormData();
  form.set('id', String(id));
  return form;
};

const envelope = (messageId: string, installationId?: string) => ({
  schemaVersion: 1,
  messageId,
  sender: 'BANK-INFO',
  receivedAt: '2026-10-07T08:00:00+05:30',
  body: `INR 1,250.50 debited on 07/10/2026. Ref UPI ${messageId}`,
  installationId,
});

const later = (ms: number) => vi.setSystemTime(new Date(NOW.getTime() + ms));

describe('SMS device pairing by one-time QR code', () => {
  it('shows a link the phone can redeem once for a working bearer token', async () => {
    const created = await invite();
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.link).toBe(
      `hisaab://pair?v=1&url=${encodeURIComponent('https://hisaab-pc.example-tailnet.ts.net')}&secret=${created.secret}`,
    );
    const link = new URL(created.link);
    expect(link.protocol).toBe('hisaab:');
    expect(link.host).toBe('pair');
    expect(link.searchParams.get('v')).toBe('1');
    expect(link.searchParams.get('url')).toBe('https://hisaab-pc.example-tailnet.ts.net');
    expect(created.expiresAt).toBe('2026-10-11T09:10:00.000Z');

    const stored = sqlite
      .prepare('SELECT secret_hash, used_at FROM sms_pairing_invites ORDER BY id DESC LIMIT 1')
      .get();
    expect(stored).toEqual({ secret_hash: hashSmsToken(created.secret), used_at: null });

    const redeemed = await redeemSmsPairingInvite({
      secret: created.secret,
      label: '  Invented phone  ',
      installationId: 'invented-installation-1',
    });
    if (!redeemed.ok) throw new Error(redeemed.message);
    expect(redeemed.status).toBe('approved');
    expect(redeemed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const device = smsDeviceRows().find((row) => row.id === redeemed.deviceId);
    expect(device).toMatchObject({
      label: 'Invented phone',
      installationId: 'invented-installation-1',
      code: null,
      approvedAt: NOW.toISOString(),
      claimedAt: NOW.toISOString(),
      revokedAt: null,
    });
    expect(
      sqlite
        .prepare('SELECT claim_hash, token_hash, token_ciphertext FROM sms_devices WHERE id = ?')
        .get(redeemed.deviceId),
    ).toEqual({
      claim_hash: null,
      token_hash: hashSmsToken(redeemed.token),
      token_ciphertext: null,
    });
    expect(
      sqlite
        .prepare('SELECT used_at, device_id FROM sms_pairing_invites WHERE secret_hash = ?')
        .get(hashSmsToken(created.secret)),
    ).toEqual({ used_at: NOW.toISOString(), device_id: redeemed.deviceId });

    const received = await receiveSms(
      redeemed.token,
      envelope('invite-msg-1', 'invented-installation-1'),
    );
    expect(received.ok && received.status).toBe('queued');
  });

  it('refuses the same code a second time', async () => {
    const created = await invite();
    await redeem(created.secret);
    const again = await redeemSmsPairingInvite({ secret: created.secret, label: 'Other phone' });
    expect(again).toMatchObject({ ok: false, status: 'expired', message: EXPIRED });
  });

  it('refuses a code once ten minutes have passed', async () => {
    const created = await invite();
    later(10 * 60 * 1000);
    const late = await redeemSmsPairingInvite({ secret: created.secret, label: 'Invented phone' });
    expect(late).toMatchObject({ ok: false, status: 'expired', message: EXPIRED });

    const fresh = await invite();
    later(20 * 60 * 1000 - 1);
    expect(await redeem(fresh.secret)).toMatchObject({ ok: true, status: 'approved' });
  });

  it('cancels the previous code when a new one is shown', async () => {
    const first = await invite();
    later(1000);
    const second = await invite();
    const old = await redeemSmsPairingInvite({ secret: first.secret, label: 'Invented phone' });
    expect(old).toMatchObject({ ok: false, status: 'expired', message: EXPIRED });
    expect(await redeem(second.secret)).toMatchObject({ ok: true, status: 'approved' });
  });

  it('rejects a malformed request without using up the code', async () => {
    const created = await invite();
    expect(
      await redeemSmsPairingInvite({ secret: 'too-short', label: 'Invented phone' }),
    ).toMatchObject({ ok: false, status: 'invalid', fieldErrors: { secret: expect.any(String) } });
    expect(
      await redeemSmsPairingInvite({ secret: `${created.secret}=`, label: 'Phone' }),
    ).toMatchObject({ ok: false, status: 'invalid' });
    expect(await redeemSmsPairingInvite({ secret: created.secret })).toMatchObject({
      ok: false,
      status: 'invalid',
      message: 'Send a device name with the pairing request.',
    });
    expect(await redeemSmsPairingInvite({ secret: created.secret, label: '   ' })).toMatchObject({
      ok: false,
      status: 'invalid',
      fieldErrors: { label: expect.any(String) },
    });
    expect(await redeemSmsPairingInvite(null)).toMatchObject({ ok: false, status: 'invalid' });
    expect(
      await redeemSmsPairingInvite({
        secret: randomBytes(32).toString('base64url'),
        label: 'Phone',
      }),
    ).toMatchObject({ ok: false, status: 'expired', message: EXPIRED });

    expect(await redeem(created.secret)).toMatchObject({ ok: true, status: 'approved' });
  });

  it.each([
    ['missing', undefined],
    ['empty', '  '],
    ['plain http', 'http://hisaab-pc.example-tailnet.ts.net'],
    ['with a password', 'https://owner:secret@hisaab-pc.example-tailnet.ts.net'],
    ['with a query', 'https://hisaab-pc.example-tailnet.ts.net/?debug=1'],
    ['with a fragment', 'https://hisaab-pc.example-tailnet.ts.net/#pair'],
    ['not a URL', 'hisaab-pc.example-tailnet.ts.net'],
  ])('needs SMS_PAIRING_URL to be a plain HTTPS address (%s)', async (_case, value) => {
    const current = await invite();
    if (value === undefined) delete process.env.SMS_PAIRING_URL;
    else process.env.SMS_PAIRING_URL = value;

    const result = await createSmsPairingInvite();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('SMS_PAIRING_URL');
    expect(await redeem(current.secret)).toMatchObject({ ok: true, status: 'approved' });
  });

  it('keeps a path in SMS_PAIRING_URL and drops the trailing slash', async () => {
    process.env.SMS_PAIRING_URL = ' https://hisaab-pc.example-tailnet.ts.net/hisaab/ ';
    const created = await invite();
    expect(new URL(created.link).searchParams.get('url')).toBe(
      'https://hisaab-pc.example-tailnet.ts.net/hisaab',
    );
  });

  it('revokes the earlier pairing when the same phone pairs again', async () => {
    const pair = async (label: string, installationId: string) => {
      const result = await redeemSmsPairingInvite({
        secret: (await invite()).secret,
        label,
        installationId,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    };
    const first = await pair('Invented phone', 'invented-installation-2');
    const other = await pair('Other phone', 'invented-installation-3');
    const again = await pair('Invented phone', 'invented-installation-2');
    expect(
      await receiveSms(first.token, envelope('invite-msg-4', 'invented-installation-2')),
    ).toMatchObject({ ok: false, message: 'That SMS device is not paired or has been revoked.' });
    expect(
      await receiveSms(again.token, envelope('invite-msg-5', 'invented-installation-2')),
    ).toMatchObject({ ok: true });
    expect(
      await receiveSms(other.token, envelope('invite-msg-6', 'invented-installation-3')),
    ).toMatchObject({ ok: true });
  });

  it('stops a revoked phone from sending messages', async () => {
    const paired = await redeem((await invite()).secret);
    expect(await receiveSms(paired.token, envelope('invite-msg-2'))).toMatchObject({ ok: true });
    expect(await revokeSmsDevice(idForm(paired.deviceId))).toEqual({ ok: true });
    expect(await receiveSms(paired.token, envelope('invite-msg-3'))).toMatchObject({
      ok: false,
      message: 'That SMS device is not paired or has been revoked.',
    });
  });
});

describe('POST /api/sms/pair/redeem', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    POST(
      new Request('http://127.0.0.1/api/sms/pair/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      }),
    );

  it('returns the bearer token once, then 410', async () => {
    const created = await invite();
    const body = JSON.stringify({ secret: created.secret, label: 'Invented phone' });
    const first = await post(body);
    expect(first.status).toBe(200);
    const json = await first.json();
    expect(json).toMatchObject({ ok: true, status: 'approved', deviceId: expect.any(Number) });
    expect(json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const second = await post(body);
    expect(second.status).toBe(410);
    expect(await second.json()).toMatchObject({ ok: false, message: EXPIRED });
  });

  it('answers 400 for bad JSON or a malformed request', async () => {
    const broken = await post('{not json');
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ ok: false, message: 'Send a JSON pairing request.' });

    const invalid = await post(JSON.stringify({ secret: 'short', label: 'Invented phone' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false, status: 'invalid' });
  });

  it('answers 413 for a body over 2 KB', async () => {
    const response = await post(JSON.stringify({ label: 'x'.repeat(3000) }), {
      'content-length': '3020',
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      ok: false,
      message: 'The pairing request is too large.',
    });
  });
});
