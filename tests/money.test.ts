import { describe, expect, it } from 'vitest';
import { fromRupees, paiseToInput, parsePaise, parsePositivePaise, toRupees } from '@/lib/domain/money';

const value = (input: string) => {
  const r = parsePaise(input);
  return r.ok ? r.value : r.message;
};

describe('parsePaise', () => {
  it('parses plain and grouped rupees', () => {
    expect(value('1250')).toBe(125000);
    expect(value('1,250.50')).toBe(125050);
    expect(value('₹ 1250')).toBe(125000);
    expect(value('1250.5')).toBe(125050);
    expect(value('0.07')).toBe(7);
    expect(value('.5')).toBe(50);
  });

  it('parses negatives, including a pasted U+2212 minus', () => {
    expect(value('-300')).toBe(-30000);
    expect(value('−18,640')).toBe(-1864000);
  });

  it('rejects more than two decimal places', () => {
    expect(parsePaise('1250.555').ok).toBe(false);
  });

  it('rejects empty and non-numeric input', () => {
    expect(parsePaise('').ok).toBe(false);
    expect(parsePaise('   ').ok).toBe(false);
    expect(parsePaise('abc').ok).toBe(false);
    expect(parsePaise('12.3.4').ok).toBe(false);
    expect(parsePaise('-').ok).toBe(false);
  });

  it('has no floating point drift', () => {
    expect(value('0.1')).toBe(10);
    expect(value('1234567.89')).toBe(123456789);
  });
});

describe('parsePositivePaise', () => {
  it('rejects zero and negatives with a message that says what to do', () => {
    expect(parsePositivePaise('0')).toEqual({
      ok: false,
      message: 'Enter an amount greater than zero.',
    });
    expect(parsePositivePaise('-5').ok).toBe(false);
    expect(parsePositivePaise('5').ok).toBe(true);
  });
});

describe('conversions', () => {
  it('round-trips rupees and paise', () => {
    expect(toRupees(125050)).toBe(1250.5);
    expect(fromRupees(1250.5)).toBe(125050);
    expect(fromRupees(0.1 + 0.2)).toBe(30);
  });

  it('renders an editable input value', () => {
    expect(paiseToInput(125050)).toBe('1250.50');
    expect(paiseToInput(7)).toBe('0.07');
    expect(paiseToInput(-1864000)).toBe('-18640.00');
  });
});
