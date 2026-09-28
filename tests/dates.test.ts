import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  currentMonth,
  daysBetween,
  daysInMonth,
  endOfMonth,
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  isLeapYear,
  isValidDate,
  isValidMonth,
  monthEndsBetween,
  monthLabel,
  monthOf,
  startOfMonth,
  today,
  yearsBetween,
} from '@/lib/domain/dates';

describe('validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidDate('2026-09-28')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-9-1')).toBe(false);
    expect(isValidMonth('2026-09')).toBe(true);
    expect(isValidMonth('2026-00')).toBe(false);
  });
});

describe('month boundaries', () => {
  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-09')).toBe('2026-09-01');
    expect(endOfMonth('2026-09')).toBe('2026-09-30');
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2024-02')).toBe('2024-02-29');
    expect(monthOf('2026-09-28')).toBe('2026-09');
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-09', 1)).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-09', -12)).toBe('2025-09');
  });

  it('lists month ends in a range', () => {
    expect(monthEndsBetween('2026-01', '2026-04')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
});

describe('leap years', () => {
  it('follows the 4/100/400 rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('counts days across a leap day without a timezone shift', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-01-01', '2024-01-01')).toBe(365);
    expect(daysBetween('2026-09-28', '2026-09-27')).toBe(-1);
    expect(yearsBetween('2023-01-01', '2024-01-01')).toBe(1);
  });
});

describe('financial year (April to March)', () => {
  it('puts 31 March and 1 April in different years', () => {
    expect(financialYearOf('2026-03-31')).toBe(2025);
    expect(financialYearOf('2026-04-01')).toBe(2026);
    expect(financialYearOf('2026-12-31')).toBe(2026);
  });

  it('builds the year range and label', () => {
    expect(financialYearRange(2026)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(financialYearLabel(2026)).toBe('2026–27');
  });

  it('supports a calendar year start month', () => {
    expect(financialYearOf('2026-03-31', 1)).toBe(2026);
    expect(financialYearRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(financialYearLabel(2026, 1)).toBe('2026');
  });
});

describe('labels and today', () => {
  it('formats a month', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
  });

  it('reads the local date, not UTC', () => {
    const lateEvening = new Date(2026, 8, 28, 23, 30);
    expect(today(lateEvening)).toBe('2026-09-28');
    expect(currentMonth(lateEvening)).toBe('2026-09');
  });
});
