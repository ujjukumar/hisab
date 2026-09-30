import { z } from 'zod';
import { isValidDate, isValidMonth } from '@/lib/domain/dates';
import { parsePaise, parsePositivePaise } from '@/lib/domain/money';

/** What every server action returns. `undo` is the token a delete hands back for its Undo toast. */
export type ActionResult =
  | { ok: true; id?: number; undo?: string }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export type ActionFailure = Extract<ActionResult, { ok: false }>;

/** Turn a Zod error into the result shape: the first message per field. */
export function invalid(error: z.ZodError): ActionFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false,
    message: error.issues[0]?.message ?? 'Check the form and try again.',
    fieldErrors,
  };
}

export function failed(message: string, field?: string): ActionFailure {
  return { ok: false, message, fieldErrors: field ? { [field]: message } : {} };
}

export const idSchema = z.coerce.number().int().positive();

/** '' and missing both mean "not chosen". */
export const optionalId = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  idSchema.nullable(),
);

export const optionalText = (max: number) =>
  z.preprocess(
    (v) => v ?? '',
    z
      .string()
      .trim()
      .max(max, `Keep this under ${max} characters.`)
      .transform((s) => s || null),
  );

export const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Keep this under ${max} characters.`);

const amount = (parse: typeof parsePaise, emptyMessage: string, emptyValue?: number) =>
  z.preprocess(
    (v) => v ?? '',
    z.string().transform((s, ctx) => {
      if (s.trim() === '' && emptyValue !== undefined) return emptyValue;
      const r = s.trim() === '' ? { ok: false as const, message: emptyMessage } : parse(s);
      if (r.ok) return r.value;
      ctx.addIssue({ code: 'custom', message: r.message });
      return z.NEVER;
    }),
  );

export const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const;

export const transactionSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES, 'Choose spending, income or transfer.'),
    amount: amount(parsePositivePaise, 'Enter an amount greater than zero.'),
    date: z.string().refine(isValidDate, 'Pick a date for this transaction.'),
    categoryId: optionalId,
    accountId: optionalId,
    toAccountId: optionalId,
    description: requiredText(200, 'Add a short description so you can find this later.'),
    note: optionalText(500),
  })
  .superRefine((t, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (t.type === 'transfer') {
      if (!t.accountId) issue('accountId', 'Choose the account the money leaves.');
      if (!t.toAccountId) issue('toAccountId', 'Choose the account the money goes to.');
      else if (t.accountId === t.toAccountId)
        issue('toAccountId', 'Choose two different accounts for a transfer.');
    } else {
      if (!t.categoryId) issue('categoryId', 'Choose a category.');
      if (!t.accountId) issue('accountId', 'Choose an account.');
    }
  })
  .transform((t) =>
    t.type === 'transfer' ? { ...t, categoryId: null } : { ...t, toAccountId: null },
  );

export type TransactionInput = z.infer<typeof transactionSchema>;

export const ACCOUNT_TYPES = ['bank', 'card', 'cash', 'wallet', 'other'] as const;

export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank: 'Bank account',
  card: 'Credit card',
  cash: 'Cash',
  wallet: 'Wallet',
  other: 'Other',
};

export const accountSchema = z.object({
  name: requiredText(60, 'Give the account a name.'),
  type: z.enum(ACCOUNT_TYPES, 'Choose the kind of account.'),
  // Signed: money owed on a card is negative. Empty means zero.
  openingBalance: amount(parsePaise, '', 0),
  openingDate: z.string().refine(isValidDate, 'Pick the date the opening balance is from.'),
  note: optionalText(200),
});

export const CATEGORY_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'] as const;

export const categorySchema = z.object({
  name: requiredText(40, 'Give the category a name.'),
  kind: z.enum(['expense', 'income'], 'Choose spending or income.'),
  color: z.enum(CATEGORY_COLORS, 'Pick a colour.'),
});

export const monthSchema = z.string().refine(isValidMonth, 'Pick a month.');

export const budgetSchema = z.object({
  categoryId: idSchema,
  month: monthSchema,
  // Empty or 0 means no budget from this month.
  amount: amount(parsePaise, '', 0).refine(
    (paise) => paise >= 0,
    'Enter a budget of zero or more. Leave it empty for no budget.',
  ),
});
