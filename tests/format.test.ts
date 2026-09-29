import { describe, expect, it } from 'vitest';
import {
  axisLabel,
  formatAmount,
  formatAmountSigned,
  formatDate,
  formatDay,
  formatINR,
  formatINRSigned,
  formatPercent,
  formatPercentNoPlus,
  formatReturn,
  formatReturnAbs,
  formatReturnPa,
  formatShortINR,
  formatShortINRSigned,
  formatUnits,
  gainClass,
  MINUS,
  niceScale,
  niceStep,
} from '@/lib/domain/format';

describe('formatINR', () => {
  it('uses Indian grouping', () => {
    expect(formatINR(16364000)).toBe('₹1,63,640');
    expect(formatINR(10828900)).toBe('₹1,08,289');
    expect(formatINR(100000)).toBe('₹1,000');
    expect(formatINR(0)).toBe('₹0');
  });

  it('shows two decimals for forms and price cells', () => {
    expect(formatINR(125050, 2)).toBe('₹1,250.50');
    expect(formatINR(23146, 2)).toBe('₹231.46');
  });

  it('uses a real minus sign for negatives', () => {
    expect(formatINR(-1864000)).toBe(`${MINUS}₹18,640`);
    expect(formatINR(-1864000)).not.toContain('-');
  });
});

describe('signed values', () => {
  it('adds + and − but leaves zero unsigned', () => {
    expect(formatINRSigned(412000)).toBe('+₹4,120');
    expect(formatINRSigned(-412000)).toBe(`${MINUS}₹4,120`);
    expect(formatINRSigned(0)).toBe('₹0');
    expect(formatAmountSigned(412000)).toBe('+4,120');
    expect(formatAmount(-412000)).toBe(`${MINUS}4,120`);
    expect(formatAmount(412000)).toBe('4,120');
  });

  it('treats an amount that rounds to zero as zero', () => {
    expect(formatINRSigned(-40)).toBe('₹0');
  });
});

describe('formatShortINR', () => {
  it('switches to Lakh at 1 Lakh and Cr at 1 Crore', () => {
    expect(formatShortINR(9999000)).toBe('₹99,990'); // just below a lakh
    expect(formatShortINR(10000000)).toBe('₹1.00 Lakh');
    expect(formatShortINR(217100000)).toBe('₹21.71 Lakh');
    expect(formatShortINR(999900000)).toBe('₹99.99 Lakh');
    expect(formatShortINR(1000000000)).toBe('₹1.00 Cr');
    expect(formatShortINR(1250000000)).toBe('₹1.25 Cr');
  });

  it('signs short values', () => {
    expect(formatShortINRSigned(1250000000)).toBe('+₹1.25 Cr');
    expect(formatShortINRSigned(-1250000000)).toBe(`${MINUS}₹1.25 Cr`);
    expect(formatShortINRSigned(0)).toBe('₹0');
  });
});

describe('percentages', () => {
  it('uses two decimals and shows zero without a sign', () => {
    expect(formatPercent(14.8)).toBe('+14.80%');
    expect(formatPercent(-6.1)).toBe(`${MINUS}6.10%`);
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('never prints −0.00%', () => {
    expect(formatPercent(-0.001)).toBe('0.00%');
    expect(formatPercentNoPlus(-0.001)).toBe('0.00%');
    expect(formatPercent(-0.001)).not.toContain(MINUS);
  });

  it('drops the plus in sub-labels and annualised returns', () => {
    expect(formatPercentNoPlus(14.8)).toBe('14.80%');
    expect(formatPercentNoPlus(-0.46)).toBe(`${MINUS}0.46%`);
    expect(formatReturnPa(14.83)).toBe('14.8% p.a.');
    expect(formatReturnAbs(3.25)).toBe('3.3% abs.');
  });

  it('formats an XIRR result from its fraction, or a dash without one', () => {
    expect(formatReturn({ kind: 'pa', rate: 0.1483 })).toBe('14.8% p.a.');
    expect(formatReturn({ kind: 'abs', rate: -0.046 })).toBe(`${MINUS}4.6% abs.`);
    expect(formatReturn(null)).toBe('—');
  });
});

describe('gainClass', () => {
  it('only colours real gains and losses', () => {
    expect(gainClass(120)).toBe('pos');
    expect(gainClass(-120)).toBe('neg');
    expect(gainClass(0)).toBe('');
    expect(gainClass(-0.001)).toBe('');
  });
});

describe('units and dates', () => {
  it('formats unit counts', () => {
    expect(formatUnits(1660.12)).toBe('1,660.120');
    expect(formatUnits(120, 0)).toBe('120');
  });

  it('formats dates for tables and compact lists', () => {
    expect(formatDate('2026-09-27')).toBe('27 Sep 2026');
    expect(formatDay('2026-09-27')).toBe('27 Sep');
    expect(formatDate('2026-01-05')).toBe('5 Jan 2026');
  });
});

describe('chart axes', () => {
  it('abbreviates tick labels', () => {
    expect(axisLabel(0)).toBe('0');
    expect(axisLabel(750)).toBe('750');
    expect(axisLabel(75000)).toBe('75K');
    expect(axisLabel(150000)).toBe('1.5L');
    expect(axisLabel(20000000)).toBe('2 Cr');
  });

  it('picks nice tick steps', () => {
    expect(niceStep(37000)).toBe(50000);
    expect(niceStep(21000)).toBe(25000);
    expect(niceStep(1)).toBe(1);
    const scale = niceScale(295000, 4);
    expect(scale.step).toBe(100000);
    expect(scale.top).toBe(300000);
    expect(scale.ticks).toBe(3);
  });

  it('survives an empty chart', () => {
    expect(niceScale(0, 4)).toEqual({ top: 1, step: 1, ticks: 1 });
  });
});
