import type { BarRow } from '@/components/charts/BarChart';
import type { Slice } from '@/components/charts/Donut';
import type { LinePoint } from '@/components/charts/LineChart';
import type { Mover } from '@/components/GainLoseTiles/GainLoseTiles';
import type { Row } from '@/components/Rows/Rows';

/** Invented figures, used only to show the components. Nothing here is real. */

export const BARS: BarRow[] = [
  { month: 'Apr', year: '2026', income: 14_580_000, spending: 7_810_000 },
  { month: 'May', year: '2026', income: 14_900_000, spending: 6_940_000 },
  { month: 'Jun', year: '2026', income: 17_250_000, spending: 10_470_000 },
  { month: 'Jul', year: '2026', income: 14_500_000, spending: 7_290_000 },
  { month: 'Aug', year: '2026', income: 15_130_000, spending: 6_830_000 },
  { month: 'Sep', year: '2026', income: 16_364_000, spending: 5_881_000 },
];

export const LINE: LinePoint[] = [
  { label: 'Mar 2026', short: 'Mar', invested: 128_000_000, worth: 134_600_000 },
  { label: 'Apr 2026', short: 'Apr', invested: 134_000_000, worth: 142_900_000 },
  { label: 'May 2026', short: 'May', invested: 140_000_000, worth: 148_100_000 },
  { label: 'Jun 2026', short: 'Jun', invested: 146_000_000, worth: 151_700_000 },
  { label: 'Jul 2026', short: 'Jul', invested: 152_000_000, worth: 163_400_000 },
  { label: 'Aug 2026', short: 'Aug', invested: 158_000_000, worth: 172_800_000 },
  { label: 'Sep 2026', short: 'Sep', invested: 170_521_000, worth: 185_937_000 },
];

export const SPENDING: Slice[] = [
  { name: 'Housing', value: 3_200_000, color: 'var(--c1)' },
  { name: 'Groceries', value: 1_012_000, color: 'var(--c2)' },
  { name: 'Dining', value: 724_000, color: 'var(--c3)' },
  { name: 'Shopping', value: 456_000, color: 'var(--c5)' },
  { name: 'Transport', value: 242_000, color: 'var(--c4)' },
  { name: 'Utilities', value: 233_900, color: 'var(--c6)' },
];

export const ACCOUNT_ROWS: Row[] = [
  { key: 'salary', name: 'Salary account', sub: 'Bank', amount: '₹2,18,450' },
  { key: 'savings', name: 'Savings account', sub: 'Bank', amount: '₹3,42,000' },
  { key: 'card', name: 'Credit card', sub: 'Due 5 Oct', amount: '−₹18,640', tone: 'neg' },
  { key: 'cash', name: 'Cash', sub: 'Wallet', amount: '₹4,200' },
  { key: 'total', name: 'Total', amount: '₹5,46,010', total: true },
];

export const GAINERS: Mover[] = [
  { id: 11, name: 'Gold bond, 2031 series', gain: 4_668_000, percent: 66.05 },
  { id: 10, name: 'Banyan Gold ETF', gain: 2_916_000, percent: 33.7 },
  { id: 1, name: 'Meridian Flexi Cap Direct-G', gain: 6_425_100, percent: 20.08 },
];

export const LOSERS: Mover[] = [
  { id: 7, name: 'Sahyadri Foods Ltd', gain: -1_133_500, percent: -7.85 },
];

export type Holding = {
  id: number;
  name: string;
  ref: string;
  units: string;
  cost: string;
  worth: string;
  gain: string;
  gainPercent: string;
  tone: 'pos' | 'neg';
};

export const HOLDINGS: Holding[] = [
  {
    id: 1,
    name: 'Meridian Flexi Cap Direct-G',
    ref: 'Folio ••7731',
    units: '1,660.120',
    cost: '3,20,000',
    worth: '3,84,251',
    gain: '+64,251',
    gainPercent: '+20.08%',
    tone: 'pos',
  },
  {
    id: 6,
    name: 'Kaveri Power Ltd',
    ref: 'Demat ••4402',
    units: '120',
    cost: '1,77,600',
    worth: '1,97,082',
    gain: '+19,482',
    gainPercent: '+10.97%',
    tone: 'pos',
  },
  {
    id: 7,
    name: 'Sahyadri Foods Ltd',
    ref: 'Demat ••4402',
    units: '45',
    cost: '1,44,450',
    worth: '1,33,115',
    gain: '−11,335',
    gainPercent: '−7.85%',
    tone: 'neg',
  },
];
