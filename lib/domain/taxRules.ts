import type { Paise } from './money';

/** New-regime income tax figures for one financial year (PLAN section 6, Tax). */

export type Slab = {
  /** Upper limit of the band in paise, null for the top band. */
  upTo: Paise | null;
  /** Percent. */
  rate: number;
};

export type TaxRules = {
  /** The year the financial year starts in: 2025 is FY 2025–26. */
  year: number;
  slabs: Slab[];
  standardDeduction: Paise;
  /** The rebate applies when total income is at most this. */
  rebateLimit: Paise;
  rebateMax: Paise;
  /** Percent. */
  cess: number;
  /** Long-term equity gains up to this are not taxed. */
  equityLongExemption: Paise;
  /** Above this total income a surcharge applies, which the estimate leaves out. */
  surchargeFrom: Paise;
};

const lakh = (n: number): Paise => Math.round(n * 100_000 * 100);
const rupees = (n: number): Paise => n * 100;

/** The first year the rules cover. Earlier years need indexation and older rates. */
export const FIRST_TAX_YEAR = 2024;

// Check every figure against the Finance Act before adding a year.
export const TAX_RULES: Record<number, TaxRules> = {
  2024: {
    year: 2024,
    slabs: [
      { upTo: lakh(3), rate: 0 },
      { upTo: lakh(7), rate: 5 },
      { upTo: lakh(10), rate: 10 },
      { upTo: lakh(12), rate: 15 },
      { upTo: lakh(15), rate: 20 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: rupees(75_000),
    rebateLimit: lakh(7),
    rebateMax: rupees(25_000),
    cess: 4,
    equityLongExemption: rupees(125_000),
    surchargeFrom: lakh(50),
  },
  2025: {
    year: 2025,
    slabs: [
      { upTo: lakh(4), rate: 0 },
      { upTo: lakh(8), rate: 5 },
      { upTo: lakh(12), rate: 10 },
      { upTo: lakh(16), rate: 15 },
      { upTo: lakh(20), rate: 20 },
      { upTo: lakh(24), rate: 25 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: rupees(75_000),
    rebateLimit: lakh(12),
    rebateMax: rupees(60_000),
    cess: 4,
    equityLongExemption: rupees(125_000),
    surchargeFrom: lakh(50),
  },
};

export function taxRulesFor(year: number): TaxRules | null {
  return TAX_RULES[year] ?? null;
}
