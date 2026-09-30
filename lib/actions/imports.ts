'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { backupsFolder, backupTo } from '@/lib/db/connect';
import { db, sqlite } from '@/lib/db/client';
import { ASSET_CLASSES } from '@/lib/domain/assets';
import { parseValueResearch, type VrFile } from '@/lib/domain/valueResearch';
import { planImport, type ImportChoices, type ImportPlan } from '@/lib/queries/imports';
import { failed, idSchema, invalid, optionalId, type ActionFailure } from '@/lib/validation/money';
import { XlsError, readXls } from '@/lib/xls';
import { NOTHING_NEW, applyImport } from './applyImport';

const CHOOSE = 'Choose the .xls file Value Research downloads.';

const fileSchema = z.object({
  file: z
    .instanceof(File, { error: CHOOSE })
    .refine((f) => f.size > 0 && /\.xls$/i.test(f.name), CHOOSE)
    .refine(
      (f) => f.size <= 5 * 1024 * 1024,
      'That file is over 5 MB. Choose the .xls file Value Research downloads.',
    ),
});

const choiceSchema = z.object({
  accountId: optionalId,
  match: z.record(z.string(), z.union([z.literal('new'), idSchema])),
  assetClass: z.record(z.string(), z.enum(ASSET_CLASSES)),
});

/** The file and the choices from the form: `match-<ISIN>`, `class-<ISIN>` and `accountId`. */
async function read(
  formData: FormData,
): Promise<
  { ok: true; file: VrFile; choices: ImportChoices; accountId: number | null } | ActionFailure
> {
  const parsedFile = fileSchema.safeParse({ file: formData.get('file') });
  if (!parsedFile.success) return invalid(parsedFile.error);
  const match: Record<string, string> = {};
  const assetClass: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value !== 'string') continue;
    if (key.startsWith('match-')) match[key.slice(6)] = value;
    if (key.startsWith('class-')) assetClass[key.slice(6)] = value;
  }
  const choices = choiceSchema.safeParse({
    accountId: formData.get('accountId') ?? '',
    match,
    assetClass,
  });
  if (!choices.success) return failed('Check the choices for each investment and try again.');

  let file: VrFile;
  try {
    file = parseValueResearch(readXls(Buffer.from(await parsedFile.data.file.arrayBuffer())));
  } catch (error) {
    if (error instanceof XlsError) return failed(error.message, 'file');
    throw error;
  }
  const { accountId, ...rest } = choices.data;
  return { ok: true, file, choices: rest, accountId: accountId ?? null };
}

/** Check a file and show what importing it would do. Changes nothing. */
export async function previewImport(
  formData: FormData,
): Promise<{ ok: true; plan: ImportPlan } | ActionFailure> {
  const input = await read(formData);
  if (!input.ok) return input;
  return { ok: true, plan: planImport(db, input.file, input.choices) };
}

/** Import the file's transactions, after a backup. */
export async function importTransactions(
  formData: FormData,
): Promise<{ ok: true; added: number } | ActionFailure> {
  const input = await read(formData);
  if (!input.ok) return input;

  // Only back up when there is something to import, so a file with problems leaves no stray backup.
  const plan = planImport(db, input.file, input.choices);
  const [problem] = plan.problems;
  if (problem) return failed(problem);
  if (!plan.add.length) return failed(NOTHING_NEW);
  backupTo(sqlite, backupsFolder(), '-pre-import');

  const result = applyImport(db, input.file, input.choices, input.accountId);
  if (!result.ok) return failed(result.message);
  revalidatePath('/investments', 'layout');
  revalidatePath('/money', 'layout');
  revalidatePath('/');
  return { ok: true, added: result.added };
}
