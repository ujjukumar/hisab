'use server';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, sqlite } from '@/lib/db/client';
import {
  BackupError,
  backupTo,
  backupsFolder,
  ensureDefaults,
  prepareBackup,
  restoreFrom,
  wipeAll,
} from '@/lib/db/connect';
import { settings } from '@/lib/db/schema';
import { withTransaction } from '@/lib/db/transaction';
import { COMPOUNDING } from '@/lib/domain/assets';
import { clearUndo } from '@/lib/undo';
import { failed, invalid, type ActionResult } from '@/lib/validation/money';

const restoreSchema = z.object({
  file: z
    .instanceof(File, { error: 'Choose a backup file (.db) to restore.' })
    .refine((f) => f.size > 0, 'Choose a backup file (.db) to restore.'),
});

/**
 * Restore from backup: check the upload, bring it up to this version, save a copy of the
 * current data to data/backups, then swap every row in one transaction.
 */
export async function restoreBackup(formData: FormData): Promise<ActionResult> {
  const parsed = restoreSchema.safeParse({ file: formData.get('file') });
  if (!parsed.success) return invalid(parsed.error);

  const dir = mkdtempSync(join(tmpdir(), 'hisaab-restore-'));
  try {
    const file = join(dir, 'upload.db');
    writeFileSync(file, Buffer.from(await parsed.data.file.arrayBuffer()));
    prepareBackup(file);
    backupTo(sqlite, backupsFolder(), '-pre-restore');
    restoreFrom(sqlite, file);
  } catch (error) {
    if (error instanceof BackupError) return failed(error.message, 'file');
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  clearUndo();
  revalidatePath('/', 'layout');
  return { ok: true };
}

const startFreshSchema = z.object({
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm.' }),
});

/** Remove sample data and start fresh: back up, wipe every table, recreate the default categories. */
export async function startFresh(input: { confirm: string }): Promise<ActionResult> {
  const parsed = startFreshSchema.safeParse({ confirm: input.confirm.trim() });
  if (!parsed.success) return invalid(parsed.error);

  backupTo(sqlite, backupsFolder(), '-pre-reset');
  withTransaction(sqlite, () => {
    wipeAll(sqlite);
    ensureDefaults(sqlite);
  });
  clearUndo();
  revalidatePath('/', 'layout');
  return { ok: true };
}

const preferencesSchema = z.object({
  financialYearStartMonth: z.coerce
    .number({ error: 'Choose the month your financial year starts in.' })
    .int()
    .min(1, 'Choose the month your financial year starts in.')
    .max(12, 'Choose the month your financial year starts in.'),
  defaultCompounding: z.enum(COMPOUNDING, { error: 'Choose how interest compounds.' }),
});

export async function savePreferences(formData: FormData): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const values = {
    financial_year_start_month: String(parsed.data.financialYearStartMonth),
    default_fd_compounding: JSON.stringify(parsed.data.defaultCompounding),
  };

  db.transaction((tx) => {
    for (const [key, value] of Object.entries(values)) {
      tx.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date().toISOString() },
        })
        .run();
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}
