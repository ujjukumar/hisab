import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-pairing-'));
process.env.DATABASE_PATH = join(directory, 'pairing.db');
process.env.SMS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const {
  approveSmsDevice,
  claimSmsDeviceToken,
  receiveSms,
  rejectSmsDevice,
  requestSmsDevicePairing,
  revokeSmsDevice,
} = await import('@/lib/actions/sms');
const { pendingSmsDeviceRows, smsDeviceRows } = await import('@/lib/queries/sms');
const { sqlite } = await import('@/lib/db/client');

afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

const idForm = (id: number) => {
  const form = new FormData();
  form.set('id', String(id));
  return form;
};

const request = async (label: string) => {
  const result = await requestSmsDevicePairing({ label });
  if (!result.ok) throw new Error(result.message);
  return result;
};

const envelope = (messageId: string) => ({
  schemaVersion: 1,
  messageId,
  sender: 'BANK-INFO',
  receivedAt: '2026-10-07T08:00:00+05:30',
  body: 'INR 1,250.50 debited on 07/10/2026. Ref UPI ABC12345',
});

const clearPending = async () => {
  for (const device of pendingSmsDeviceRows()) await rejectSmsDevice(idForm(device.id));
};

describe('SMS device pairing by request and approval', () => {
  it('creates a waiting request that cannot send messages yet', async () => {
    await clearPending();
    const pairing = await request('Invented phone');
    expect(pairing.status).toBe('pending');
    expect(pairing.code).toMatch(/^[A-Z2-9]{6}$/);

    const waiting = pendingSmsDeviceRows().find((device) => device.id === pairing.deviceId);
    expect(waiting?.label).toBe('Invented phone');
    expect(smsDeviceRows().some((device) => device.id === pairing.deviceId)).toBe(false);

    await expect(claimSmsDeviceToken(pairing.claimToken)).resolves.toEqual({
      ok: true,
      status: 'pending',
    });
  });

  it('hands the bearer token over exactly once after approval', async () => {
    await clearPending();
    const pairing = await request('Invented phone');
    expect(await approveSmsDevice(idForm(pairing.deviceId))).toEqual({ ok: true });

    const claimed = await claimSmsDeviceToken(pairing.claimToken);
    expect(claimed.ok && claimed.status).toBe('approved');
    const token = claimed.ok && claimed.status === 'approved' ? claimed.token : '';
    expect(token).not.toBe('');

    const again = await claimSmsDeviceToken(pairing.claimToken);
    expect(again).toEqual({ ok: true, status: 'claimed', deviceId: pairing.deviceId });

    const received = await receiveSms(token, envelope('pair-msg-1'));
    expect(received.ok && received.status).toBe('queued');

    expect(pendingSmsDeviceRows().some((device) => device.id === pairing.deviceId)).toBe(false);
    expect(smsDeviceRows().some((device) => device.id === pairing.deviceId)).toBe(true);
  });

  it('refuses to approve the same request twice', async () => {
    await clearPending();
    const pairing = await request('Invented phone');
    expect(await approveSmsDevice(idForm(pairing.deviceId))).toEqual({ ok: true });
    expect(await approveSmsDevice(idForm(pairing.deviceId))).toMatchObject({
      ok: false,
      message: 'That device is already approved.',
    });
  });

  it('stops a rejected request from ever collecting a token', async () => {
    await clearPending();
    const pairing = await request('Invented phone');
    expect(await rejectSmsDevice(idForm(pairing.deviceId))).toEqual({ ok: true });
    const claimed = await claimSmsDeviceToken(pairing.claimToken);
    expect(claimed.ok).toBe(false);
    expect(await approveSmsDevice(idForm(pairing.deviceId))).toMatchObject({
      ok: false,
      message: 'That pairing request is no longer waiting.',
    });
  });

  it('stops a revoked device from sending messages', async () => {
    await clearPending();
    const pairing = await request('Invented phone');
    await approveSmsDevice(idForm(pairing.deviceId));
    const claimed = await claimSmsDeviceToken(pairing.claimToken);
    const token = claimed.ok && claimed.status === 'approved' ? claimed.token : '';
    expect(await revokeSmsDevice(idForm(pairing.deviceId))).toEqual({ ok: true });
    const received = await receiveSms(token, envelope('pair-msg-2'));
    expect(received.ok).toBe(false);
  });

  it('rejects an unknown claim token and an unpaired bearer token', async () => {
    const claimed = await claimSmsDeviceToken('not-a-real-claim-token');
    expect(claimed.ok).toBe(false);
    const received = await receiveSms('not-a-real-bearer-token', envelope('pair-msg-3'));
    expect(received.ok).toBe(false);
  });

  it('caps how many requests can wait at once', async () => {
    await clearPending();
    for (let index = 0; index < 5; index += 1) await request(`Invented phone ${index}`);
    const overflow = await requestSmsDevicePairing({ label: 'Invented phone 5' });
    expect(overflow).toMatchObject({
      ok: false,
      message: 'Too many pairing requests are waiting. Approve or reject one in Money → SMS first.',
    });
    await clearPending();
    expect(pendingSmsDeviceRows()).toHaveLength(0);
  });

  it('needs a device name', async () => {
    const result = await requestSmsDevicePairing({});
    expect(result).toMatchObject({ ok: false, message: 'Send a device name with the pairing request.' });
  });
});
