import { smsDeviceStatus, bearerToken, smsV2ErrorResponse } from '@/lib/actions/smsInbound';

/** The phone's connection check: who it is paired as and whether Hisaab can store SMS. */
export async function GET(request: Request) {
  const result = smsDeviceStatus(bearerToken(request));
  if (!result.ok) return smsV2ErrorResponse(result);
  return Response.json(result, { status: 200 });
}
