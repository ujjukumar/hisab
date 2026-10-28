import { Decimal } from 'decimal.js';
import type { GainSummary, SpecialGain } from './capitalGains';
import type { IsoDate } from './dates';
import { byDateThenId, type HoldingTxn } from './holdings';
import type { Paise } from './money';
import type { TaxRules } from './taxRules';

/** The year's new-regime tax worked line by line (PLAN section 6, Tax). An estimate, not advice. */

export type TaxInputs = {
  salary: Paise;
  interest: Paise;
  dividends: Paise;
  otherIncome: Paise;
  /** Net intraday result; a loss counts as nothing this year. */
  intraday: Paise;
  gains: Pick<GainSummary, 'slab' | 'special'>;
  salaryTds: Paise;
  otherTds: Paise;
  taxPaid: Paise;
};

export type Band = { from: Paise; upTo: Paise | null; rate: number; income: Paise; tax: Paise };

export type SpecialLine = SpecialGain & {
  /** The long-term equity allowance used on this line. */
  exemption: Paise;
  /** Unused basic exemption set against this line. */
  basicUsed: Paise;
  taxable: Paise;
  tax: Paise;
};

export type TaxComputation = {
  salary: Paise;
  standardDeduction: Paise;
  salaryIncome: Paise;
  interest: Paise;
  dividends: Paise;
  otherIncome: Paise;
  speculative: Paise;
  slabGains: Paise;
  slabIncome: Paise;
  bands: Band[];
  slabTax: Paise;
  special: SpecialLine[];
  specialTax: Paise;
  totalIncome: Paise;
  rebate: Paise;
  /** Marginal relief just above the rebate limit. */
  relief: Paise;
  taxBeforeCess: Paise;
  cess: Paise;
  totalTax: Paise;
  salaryTds: Paise;
  otherTds: Paise;
  taxPaid: Paise;
  paid: Paise;
  /** Left to pay when positive, a refund when negative. */
  balance: Paise;
  /** Total income is above the surcharge threshold, which the estimate leaves out. */
  surcharge: boolean;
};

const pct = (amount: Paise, rate: number): Paise =>
  new Decimal(amount).times(rate).div(100).round().toNumber();

/**
 * Interest an FD paid out by withdrawals between two dates: what each withdrawal took
 * beyond the amount still invested, the same excess holdings count as realised gain.
 */
export function fdWithdrawalInterest(txns: HoldingTxn[], from: IsoDate, to: IsoDate): Paise {
  let invested = 0;
  let interest = 0;
  for (const t of [...txns].sort(byDateThenId)) {
    const amount = t.amount ?? 0;
    if (t.action === 'deposit') invested += amount + t.fees;
    else if (t.action === 'fee') invested += amount;
    else if (t.action === 'withdrawal') {
      if (t.date >= from && t.date <= to) interest += Math.max(0, amount - invested);
      invested = Math.max(0, invested - amount);
    }
  }
  return interest;
}

export function computeTax(rules: TaxRules, inputs: TaxInputs): TaxComputation {
  const standardDeduction = Math.min(Math.max(inputs.salary, 0), rules.standardDeduction);
  const salaryIncome = Math.max(inputs.salary, 0) - standardDeduction;
  const speculative = Math.max(inputs.intraday, 0);
  const slabGains = Math.max(inputs.gains.slab, 0);
  const slabIncome =
    salaryIncome + inputs.interest + inputs.dividends + inputs.otherIncome + speculative + slabGains;

  const bands: Band[] = [];
  let from = 0;
  for (const s of rules.slabs) {
    const top = s.upTo ?? Infinity;
    const income = Math.max(0, Math.min(slabIncome, top) - from);
    bands.push({ from, upTo: s.upTo, rate: s.rate, income, tax: pct(income, s.rate) });
    from = top;
  }
  const slabTax = bands.reduce((sum, b) => sum + b.tax, 0);

  const basic = rules.slabs[0]?.rate === 0 ? (rules.slabs[0].upTo ?? 0) : 0;
  let shortfall = Math.max(0, basic - slabIncome);
  let allowance = rules.equityLongExemption;
  const special: SpecialLine[] = inputs.gains.special.map((g) => {
    const exemption = g.kind === 'equity_long' ? Math.min(allowance, g.gain) : 0;
    allowance -= exemption;
    const basicUsed = Math.min(shortfall, g.gain - exemption);
    shortfall -= basicUsed;
    const taxable = g.gain - exemption - basicUsed;
    return { ...g, exemption, basicUsed, taxable, tax: pct(taxable, g.rate) };
  });
  const specialTax = special.reduce((sum, l) => sum + l.tax, 0);

  const totalIncome = slabIncome + inputs.gains.special.reduce((sum, g) => sum + g.gain, 0);
  let rebate = 0;
  let relief = 0;
  if (totalIncome <= rules.rebateLimit) {
    rebate = Math.min(slabTax, rules.rebateMax);
  } else {
    relief = Math.min(slabTax, Math.max(0, slabTax + specialTax - (totalIncome - rules.rebateLimit)));
  }

  const taxBeforeCess = slabTax - rebate - relief + specialTax;
  const cess = pct(taxBeforeCess, rules.cess);
  const totalTax = taxBeforeCess + cess;
  const paid = inputs.salaryTds + inputs.otherTds + inputs.taxPaid;

  return {
    salary: inputs.salary,
    standardDeduction,
    salaryIncome,
    interest: inputs.interest,
    dividends: inputs.dividends,
    otherIncome: inputs.otherIncome,
    speculative,
    slabGains,
    slabIncome,
    bands,
    slabTax,
    special,
    specialTax,
    totalIncome,
    rebate,
    relief,
    taxBeforeCess,
    cess,
    totalTax,
    salaryTds: inputs.salaryTds,
    otherTds: inputs.otherTds,
    taxPaid: inputs.taxPaid,
    paid,
    balance: totalTax - paid,
    surcharge: totalIncome > rules.surchargeFrom,
  };
}
