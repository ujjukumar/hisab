import 'server-only';
import { randomUUID } from 'node:crypto';

/** Undo for changes that take effect at once: keep a way to put things back, for a minute. */

type Entry = { expires: number; restore: () => void };

// ponytail: in-memory, so Undo is lost if the server restarts in the few seconds the toast is up.
const store = globalThis as unknown as { hisaabUndo?: Map<string, Entry> };
const entries = (store.hisaabUndo ??= new Map());

/** Remember how to reverse a change. Returns the token the toast's Undo hands back. */
export function keepForUndo(restore: () => void): string {
  const now = Date.now();
  for (const [token, entry] of entries) if (entry.expires < now) entries.delete(token);
  const token = randomUUID();
  entries.set(token, { expires: now + 60_000, restore });
  return token;
}

/** The restore for a token, once only. Null when unknown or expired. */
export function takeUndo(token: unknown): (() => void) | null {
  const entry = typeof token === 'string' ? entries.get(token) : undefined;
  if (!entry) return null;
  entries.delete(token as string);
  return entry.expires < Date.now() ? null : entry.restore;
}
