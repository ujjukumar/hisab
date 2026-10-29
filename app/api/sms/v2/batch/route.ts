import { revalidatePath } from 'next/cache';
import {
  SMS_BATCH_MAX_BYTES,
  bearerToken,
  receiveSmsBatch,
  smsV2Error,
  smsV2ErrorResponse,
} from '@/lib/actions/smsInbound';

const TOO_LARGE = smsV2Error(413, 'too_large', 'Send at most 256 KB per batch.');

/** The phone delivers up to 50 SMS at once and gets a result for each. */
export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token)
    return smsV2ErrorResponse(
      smsV2Error(401, 'token_missing', 'Pair this phone with Hisaab first.'),
    );
  if (Number(request.headers.get('content-length') ?? 0) > SMS_BATCH_MAX_BYTES) {
    return smsV2ErrorResponse(TOO_LARGE);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > SMS_BATCH_MAX_BYTES) return smsV2ErrorResponse(TOO_LARGE);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return smsV2ErrorResponse(smsV2Error(400, 'invalid_json', 'Send the batch as JSON.'));
  }
  const result = receiveSmsBatch(token, body);
  if (!result.ok) return smsV2ErrorResponse(result);
  if (result.results.some((item) => item.status === 'accepted')) {
    revalidatePath('/');
    revalidatePath('/money', 'layout');
    revalidatePath('/money/sms');
  }
  return Response.json(result, { status: 200 });
}
