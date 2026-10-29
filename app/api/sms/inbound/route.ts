import { revalidatePath } from 'next/cache';
import { receiveSms } from '@/lib/actions/sms';
import { SMS_NOT_CONFIGURED } from '@/lib/actions/smsInbound';
import { smsEncryptionConfigured } from '@/lib/sms/security';

const MAX_BODY = 8 * 1024;

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) {
    return Response.json({ ok: false, message: 'Use a paired SMS device token.' }, { status: 401 });
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return Response.json({ ok: false, message: 'The SMS envelope is too large.' }, { status: 413 });
  }
  // The phone retries 5xx, so a missing key keeps its messages instead of failing them.
  if (!smsEncryptionConfigured()) {
    return Response.json(
      { ok: false, code: 'server_not_configured', message: SMS_NOT_CONFIGURED },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Send a JSON SMS envelope.' }, { status: 400 });
  }
  const result = await receiveSms(token, body);
  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }
  revalidatePath('/');
  revalidatePath('/money', 'layout');
  revalidatePath('/money/sms');
  return Response.json(result, { status: 200 });
}
