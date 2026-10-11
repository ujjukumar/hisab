import 'server-only';

/** How long a pairing code from Money -> SMS can be used. */
export const SMS_PAIRING_LIFETIME_MS = 10 * 60 * 1000;

export const SMS_PAIRING_URL_REQUIRED =
  'Set SMS_PAIRING_URL on the server to the tailnet HTTPS address of Hisaab, such as https://hisaab-pc.tailnet-name.ts.net, then restart Hisaab.';
export const SMS_PAIRING_CODE_EXPIRED =
  'This pairing code expired or was already used. Show a new code in Hisaab.';

/**
 * The tailnet HTTPS address the phone uses to reach Hisaab, from SMS_PAIRING_URL.
 * Hisaab only listens on 127.0.0.1 and is often opened on this PC, so the request
 * can't tell us this. Returns null unless it is a plain https:// address.
 */
export function smsPairingUrl(value = process.env.SMS_PAIRING_URL): string | null {
  const text = value?.trim();
  if (!text || /[?#]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  return url.href.replace(/\/+$/, '');
}

/** The link in the QR code. The phone accepts only this exact shape. */
export function smsPairingLink(baseUrl: string, secret: string): string {
  return `hisaab://pair?v=1&url=${encodeURIComponent(baseUrl)}&secret=${secret}`;
}
