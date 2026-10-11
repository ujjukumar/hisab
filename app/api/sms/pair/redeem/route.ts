import { redeemSmsPairingInvite } from '@/lib/actions/sms';

const MAX_BODY = 2 * 1024;

/** The phone redeems the one-time QR code from Money -> SMS and collects its bearer token once. */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return Response.json(
      { ok: false, message: 'The pairing request is too large.' },
      { status: 413 },
    );
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Send a JSON pairing request.' }, { status: 400 });
  }
  const result = await redeemSmsPairingInvite(input);
  const status = result.ok ? 200 : result.status === 'expired' ? 410 : 400;
  return Response.json(result, { status });
}
