import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const KEY_BYTES = 32;

export const ENCRYPTION_KEY_REQUIRED = 'SMS_ENCRYPTION_KEY is required for SMS ingestion.';
export const SMS_DECRYPTION_FAILED = 'The SMS could not be decrypted with SMS_ENCRYPTION_KEY.';

function key(): Buffer {
  const value = process.env.SMS_ENCRYPTION_KEY;
  if (!value) {
    throw new Error(ENCRYPTION_KEY_REQUIRED);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error('SMS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return decoded;
}

/** Whether SMS_ENCRYPTION_KEY is set to a usable key, so SMS can be stored. */
export function smsEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function createSmsToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSmsToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptSmsText(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSmsText(value: string): string {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Invalid SMS ciphertext.');
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid SMS ciphertext.');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error(SMS_DECRYPTION_FAILED, { cause: error });
  }
}

export function encryptSmsBody(body: string): string {
  return encryptSmsText(body);
}

export function decryptSmsBody(value: string): string {
  return decryptSmsText(value);
}
