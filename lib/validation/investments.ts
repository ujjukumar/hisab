import { Decimal } from 'decimal.js';
import { z } from 'zod';
import type { InvestmentAction } from '@/lib/db/schema';
import { ASSET_CLASSES, ASSET_TYPES, COMPOUNDING, defaultValuation } from '@/lib/domain/assets';
import { isValidDate } from '@/lib/domain/dates';
import { unitsAmount } from '@/lib/domain/holdings';
import { parsePaise, parsePositivePaise } from '@/lib/domain/money';
import { optionalId, optionalText, requiredText } from './money';

export const INVESTMENT_ACTIONS = [
  'buy',
  'sell',
  'split',
  'deposit',
  'withdrawal',
  'dividend',
  'interest',
  'fee',
] as const satisfies readonly InvestmentAction[];

/**
 * A plain decimal like '1,660.1234' → '1660.1234'. Null when empty, not a number,
 * or with more decimals than allowed. Units and prices are stored as these strings.
 */
export function parseDecimal(input: string, maxDecimals: number): string | null {
  const s = input.replace(/[,\s₹]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  if ((s.split('.')[1] ?? '').length > maxDecimals) return null;
  return new Decimal(s).toFixed();
}

const text = z.preprocess((v) => v ?? '', z.string().trim());
const optionalDate = (message: string) =>
  z.preprocess((v) => v || null, z.string().refine(isValidDate, message).nullable());

/* ---------- assets ---------- */

export const assetSchema = z
  .object({
    name: requiredText(80, 'Give the investment a name.'),
    type: z.enum(ASSET_TYPES, 'Choose the kind of investment.'),
    assetClass: z.enum(ASSET_CLASSES, 'Choose an asset class.'),
    accountRef: optionalText(60),
    symbol: optionalText(40),
    navStartDate: optionalDate('Pick a valid first NAV date.'),
    interestRate: text,
    compounding: z.preprocess(
      (v) => v || null,
      z.enum(COMPOUNDING, 'Choose how often interest is added.').nullable(),
    ),
    startDate: optionalDate('Pick a valid start date.'),
    maturityDate: optionalDate('Pick a valid maturity date.'),
    note: optionalText(200),
  })
  .transform((a, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const hasRate = a.type === 'fixed_deposit' || a.type === 'bond';
    const hasDates = hasRate || a.type === 'ppf';
    const valuation = defaultValuation(a.type);

    let interestRate: string | null = null;
    if (hasRate && a.interestRate) {
      interestRate = parseDecimal(a.interestRate.replace(/%$/, ''), 4);
      if (!interestRate || new Decimal(interestRate).lte(0) || new Decimal(interestRate).gt(50)) {
        issue('interestRate', 'Enter the yearly interest rate, for example 7.1.');
      }
    } else if (valuation === 'fd') {
      issue('interestRate', 'Enter the yearly interest rate, for example 7.1.');
    }
    const startDate = hasDates ? a.startDate : null;
    const maturityDate = hasDates ? a.maturityDate : null;
    if (valuation === 'fd' && !startDate) issue('startDate', 'Pick the date the deposit started.');
    if (startDate && maturityDate && maturityDate <= startDate) {
      issue('maturityDate', 'Pick a maturity date after the start date.');
    }
    return {
      ...a,
      valuation,
      navStartDate: a.type === 'mutual_fund' ? a.navStartDate : null,
      interestRate,
      compounding: hasRate ? (a.compounding ?? 'quarterly') : null,
      startDate,
      maturityDate,
    };
  });

export type AssetInput = z.infer<typeof assetSchema>;

/* ---------- investment transactions ---------- */

const AMOUNT_MESSAGES: Partial<Record<InvestmentAction, string>> = {
  deposit: 'Enter the amount you paid in.',
  withdrawal: 'Enter the amount you took out.',
  dividend: 'Enter the dividend you received.',
  interest: 'Enter the interest you received.',
  fee: 'Enter the fee you paid.',
};

export const investmentTxnSchema = z
  .object({
    assetId: text,
    action: z.enum(INVESTMENT_ACTIONS, 'Choose what happened.'),
    date: z.string().refine(isValidDate, 'Pick the date of this transaction.'),
    units: text,
    price: text,
    amount: text,
    fees: text,
    splitFrom: text,
    splitTo: text,
    accountId: optionalId,
    note: optionalText(200),
  })
  .transform((t, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    const assetId: number | 'new' | null =
      t.assetId === 'new' ? 'new' : /^\d+$/.test(t.assetId) ? Number(t.assetId) : null;
    if (!assetId) issue('assetId', 'Choose an investment.');

    let units: string | null = null;
    let price: string | null = null;
    let amount = 0;
    let fees = 0;
    let splitFrom: number | null = null;
    let splitTo: number | null = null;
    let accountId = t.accountId;

    if (t.action === 'buy' || t.action === 'sell') {
      const bought = t.action === 'buy';
      units = parseDecimal(t.units, 6);
      if (!units || new Decimal(units).lte(0)) {
        issue('units', `Enter how many units you ${bought ? 'bought' : 'sold'}.`);
      }
      price = parseDecimal(t.price, 6);
      if (!price || (!bought && new Decimal(price).lte(0))) {
        issue(
          'price',
          bought
            ? 'Enter the price per unit, or 0 for bonus units.'
            : 'Enter the price you sold at.',
        );
      }
      const f = t.fees ? parsePaise(t.fees) : { ok: true as const, value: 0 };
      if (!f.ok || f.value < 0) issue('fees', 'Enter fees of zero or more, or leave it empty.');
      else fees = f.value;
      if (units && price) amount = unitsAmount(units, price);
      if (!bought && units && price && fees >= amount) {
        issue('fees', 'Fees must be less than the sale amount.');
      }
    } else if (t.action === 'split') {
      const whole = (s: string) => (/^\d{1,4}$/.test(s) && Number(s) > 0 ? Number(s) : null);
      splitFrom = whole(t.splitFrom);
      splitTo = whole(t.splitTo);
      if (!splitFrom || !splitTo) {
        issue('splitFrom', 'Enter whole numbers for the split, for example 1 and 5.');
      } else if (splitFrom === splitTo) {
        issue('splitFrom', 'Enter a split that changes the number of units.');
      }
      accountId = null;
    } else {
      const a = parsePositivePaise(t.amount);
      if (!a.ok) issue('amount', AMOUNT_MESSAGES[t.action] ?? a.message);
      else amount = a.value;
    }

    // Nothing to link when no money moved, e.g. bonus units.
    if (accountId && amount + (t.action === 'buy' ? fees : 0) === 0) accountId = null;

    return {
      assetId: assetId ?? 'new',
      action: t.action,
      date: t.date,
      units,
      price,
      amount: t.action === 'split' ? null : amount,
      fees,
      splitFrom,
      splitTo,
      accountId,
      note: t.note,
    };
  });

export type InvestmentTxnInput = z.infer<typeof investmentTxnSchema>;
