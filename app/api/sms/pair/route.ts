import { claimSmsDeviceToken, requestSmsDevicePairing } from '@/lib/actions/sms';

const MAX_BODY = 2 * 1024;

/** Step one: the phone asks to pair. The request stays inert until the owner approves it. */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return Response.json({ ok: false, message: 'The pairing request is too large.' }, { status: 413 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Send a JSON pairing request.' }, { status: 400 });
  }
  const result = await requestSmsDevicePairing(input);
  return Response.json(result, { status: result.ok ? 202 : 400 });
}

/** Step three: the phone polls with its claim token and collects the bearer token once. */
export async function GET(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const claimToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!claimToken) {
    return Response.json({ ok: false, message: 'Use the pairing claim token.' }, { status: 401 });
  }
  const result = await claimSmsDeviceToken(claimToken);
  return Response.json(result, { status: result.ok ? 200 : 401 });
}
