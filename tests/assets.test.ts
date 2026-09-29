import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  defaultAssetClass,
  defaultValuation,
  groupOf,
  maskRef,
} from '@/lib/domain/assets';

describe('asset defaults', () => {
  it('groups types for the overview', () => {
    expect(groupOf('etf')).toBe('stock');
    expect(groupOf('ppf')).toBe('fixed');
    expect(groupOf('nps')).toBe('nps');
  });

  it('picks the valuation method and asset class from the type', () => {
    expect(defaultValuation('mutual_fund')).toBe('units');
    expect(defaultValuation('fixed_deposit')).toBe('fd');
    expect(defaultValuation('epf')).toBe('manual');
    expect(defaultAssetClass('gold')).toBe('gold');
    expect(defaultAssetClass('bond')).toBe('debt');
    expect(defaultAssetClass('stock')).toBe('equity');
  });

  it('offers buy and sell only for units assets', () => {
    expect(actionsFor('units')).toContain('sell');
    expect(actionsFor('fd')).toEqual(['deposit', 'withdrawal', 'interest', 'fee']);
  });
});

describe('maskRef', () => {
  it('keeps the last four characters of long numbers', () => {
    expect(maskRef('Folio 12347731')).toBe('Folio ••7731');
    expect(maskRef('Demat IN30012344402')).toBe('Demat ••4402');
  });

  it('leaves words, short numbers and masked refs alone', () => {
    expect(maskRef('Savings account')).toBe('Savings account');
    expect(maskRef('Matures 2034')).toBe('Matures 2034');
    expect(maskRef('Folio ••7731')).toBe('Folio ••7731');
    expect(maskRef(null)).toBe('');
  });
});
