import { describe, expect, it } from 'vitest';
import {
  computeTax,
  fdWithdrawalInterest,
  grossUpSalary,
  salaryTax,
  type TaxInputs,
} from '@/lib/domain/tax';
import type { HoldingTxn } from '@/lib/domain/holdings';
import { FIRST_TAX_YEAR, taxRulesFor } from '@/lib/domain/taxRules';

const r = (rupees: number) => rupees * 100;
const fy24 = taxRulesFor(2024)!;
const fy25 = taxRulesFor(2025)!;

const inputs = (fields: Partial<TaxInputs> = {}): TaxInputs => ({
  salary: 0,
  interest: 0,
  dividends: 0,
  otherIncome: 0,
  intraday: 0,
  gains: { slab: 0, special: [] },
  salaryTds: 0,
  otherTds: 0,
  taxPaid: 0,
  ...fields,
});

describe('taxRulesFor', () => {
  it('covers FY 2024–25 onwards and nothing earlier', () => {
    expect(FIRST_TAX_YEAR).toBe(2024);
    expect(taxRulesFor(2023)).toBeNull();
    expect(fy25.slabs.at(-1)).toEqual({ upTo: null, rate: 30 });
  });
});

describe('fdWithdrawalInterest', () => {
  let id = 1;
  const t = (date: string, action: HoldingTxn['action'], amount: number): HoldingTxn => ({
    id: id++,
    date,
    action,
    units: null,
    price: null,
    amount: r(amount),
    fees: 0,
    splitFrom: null,
    splitTo: null,
  });

  it('counts what a withdrawal takes beyond the amount invested, in the year only', () => {
    const txns = [
      t('2024-05-01', 'deposit', 100_000),
      t('2025-05-01', 'withdrawal', 107_000),
      t('2025-06-01', 'deposit', 50_000),
      t('2025-09-01', 'withdrawal', 20_000),
      t('2026-06-01', 'withdrawal', 33_000),
    ];
    expect(fdWithdrawalInterest(txns, '2025-04-01', '2026-03-31')).toBe(r(7_000));
    expect(fdWithdrawalInterest(txns, '2026-04-01', '2027-03-31')).toBe(r(3_000));
    expect(fdWithdrawalInterest(txns, '2024-04-01', '2025-03-31')).toBe(0);
  });

  it('is zero with no withdrawals', () => {
    expect(fdWithdrawalInterest([], '2025-04-01', '2026-03-31')).toBe(0);
  });
});

describe('computeTax', () => {
  it('takes nothing at exactly ₹12 lakh after the standard deduction in FY 2025–26', () => {
    const c = computeTax(fy25, inputs({ salary: r(1_275_000) }));
    expect(c.standardDeduction).toBe(r(75_000));
    expect(c.slabIncome).toBe(r(1_200_000));
    expect(c.slabTax).toBe(r(60_000));
    expect(c.rebate).toBe(r(60_000));
    expect(c.totalTax).toBe(0);
  });

  it('limits tax just above the limit to the income over it', () => {
    const c = computeTax(fy25, inputs({ salary: r(1_285_000) }));
    expect(c.slabTax).toBe(r(61_500));
    expect(c.relief).toBe(r(51_500));
    expect(c.taxBeforeCess).toBe(r(10_000));
    expect(c.totalTax).toBe(r(10_400));
  });

  it('works each band once relief no longer applies', () => {
    const c = computeTax(fy25, inputs({ salary: r(1_385_000) }));
    expect(c.bands.map((b) => b.tax)).toEqual([0, r(20_000), r(40_000), r(16_500), 0, 0, 0]);
    expect(c.relief).toBe(0);
    expect(c.cess).toBe(r(3_060));
    expect(c.totalTax).toBe(r(79_560));
  });

  it('uses the FY 2024–25 slabs', () => {
    const c = computeTax(fy24, inputs({ salary: r(2_000_000) }));
    expect(c.slabTax).toBe(r(267_500));
    expect(c.totalTax).toBe(r(278_200));
    expect(computeTax(fy24, inputs({ salary: r(775_000) })).totalTax).toBe(0);
  });

  it('owes nothing on no income and refunds what was paid', () => {
    const none = computeTax(fy25, inputs());
    expect(none.totalTax).toBe(0);
    expect(none.standardDeduction).toBe(0);
    const refund = computeTax(fy25, inputs({ salary: r(1_275_000), salaryTds: r(10_000) }));
    expect(refund.balance).toBe(-r(10_000));
  });

  it('adds interest, dividends, other income, slab gains and an intraday profit at slab rates', () => {
    const c = computeTax(
      fy25,
      inputs({ interest: r(10_000), dividends: r(5_000), otherIncome: r(1_000), intraday: r(2_000), gains: { slab: r(3_000), special: [] } }),
    );
    expect(c.slabIncome).toBe(r(21_000));
    expect(computeTax(fy25, inputs({ intraday: -r(5_000) })).speculative).toBe(0);
  });

  it('uses unused basic exemption and the equity allowance against special-rate gains', () => {
    const c = computeTax(
      fy25,
      inputs({
        interest: r(100_000),
        gains: {
          slab: 0,
          special: [
            { kind: 'equity_short', rate: 20, gain: r(200_000) },
            { kind: 'equity_long', rate: 12.5, gain: r(300_000) },
          ],
        },
      }),
    );
    expect(c.special[0]).toMatchObject({ basicUsed: r(200_000), taxable: 0, tax: 0 });
    expect(c.special[1]).toMatchObject({ exemption: r(125_000), basicUsed: r(100_000), taxable: r(75_000), tax: r(9_375) });
    expect(c.totalIncome).toBe(r(600_000));
    expect(c.rebate).toBe(0);
    expect(c.totalTax).toBe(r(9_750));
  });

  it('flags income above the surcharge threshold', () => {
    expect(computeTax(fy25, inputs({ salary: r(6_000_000) })).surcharge).toBe(true);
    expect(computeTax(fy25, inputs({ salary: r(5_000_000) })).surcharge).toBe(false);
  });
});

describe('grossUpSalary', () => {
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);

  it('keeps take-home as gross when the salary carries no tax', () => {
    expect(grossUpSalary(fy25, 0)).toEqual({ gross: 0, tds: 0 });
    expect(grossUpSalary(fy25, r(1_275_000))).toEqual({ gross: r(1_275_000), tds: 0 });
    expect(grossUpSalary(fy24, r(775_000))).toEqual({ gross: r(775_000), tds: 0 });
  });

  it('adds back the tax on the salary', () => {
    // 0.792 × gross + 2,23,600 = 18,00,000 within the 20% band.
    const g = grossUpSalary(fy25, r(1_800_000));
    expect(g.gross - g.tds).toBe(r(1_800_000));
    near(g.gross, 199_040_404);
    near(salaryTax(fy25, g.gross), g.tds);
    // FY 2024–25: 0.896 × gross + 59,800 = 10,00,000 within the 10% band.
    near(grossUpSalary(fy24, r(1_000_000)).gross, 104_933_036);
  });

  it('finds the gross past the dip marginal relief makes in take-home', () => {
    // Take-home falls to 12,72,176 just above 12,75,000 gross, then rises again.
    const g = grossUpSalary(fy25, r(1_280_000));
    near(g.gross, 135_485_782);
    expect(g.gross - g.tds).toBe(r(1_280_000));
  });
});
