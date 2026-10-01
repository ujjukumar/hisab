import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { fetchAndSave } from '@/lib/actions/priceDownloads';
import { fetchInvestmentPrices } from '@/lib/actions/prices';
import { db } from '@/lib/db/client';
import type { Asset } from '@/lib/db/schema';
import { portfolio, portfolioData } from '@/lib/queries/investments';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: { insert: vi.fn() } }));
vi.mock('@/lib/queries/investments', () => ({ portfolio: vi.fn(), portfolioData: vi.fn() }));
vi.mock('@/lib/actions/priceDownloads', () => ({ fetchAndSave: vi.fn() }));
vi.mock('@/lib/feeds', () => ({ amfiLatest: vi.fn(), amfiFor: vi.fn() }));

const asset = (id: number, type: Asset['type'], symbol: string | null): Asset => ({
  id,
  name: `Invented ${id}`,
  type,
  symbol,
  assetClass: 'equity',
  valuation: type === 'gold' ? 'manual' : 'units',
  accountRef: null,
  interestRate: null,
  compounding: null,
  startDate: null,
  maturityDate: null,
  note: null,
  archived: 0,
  createdAt: '',
  updatedAt: '',
});

beforeEach(() => {
  vi.clearAllMocks();
  const assets = [
    asset(1, 'stock', 'INE000KP0011'),
    asset(2, 'mutual_fund', 'INF000MF0012'),
    asset(3, 'gold', null),
    asset(4, 'stock', 'INE000SF0019'),
    asset(5, 'stock', null),
  ];
  vi.mocked(portfolioData).mockReturnValue({ assets, txns: [], prices: [], valuations: [] });
  vi.mocked(portfolio).mockReturnValue(
    assets.map((item) => ({ asset: item, sold: item.id === 4 })) as ReturnType<typeof portfolio>,
  );
  vi.mocked(fetchAndSave).mockResolvedValue({ updated: 1, problems: [], unavailable: false });
});

describe('fetchInvestmentPrices', () => {
  it('fetches only the selected held investments and does not mark every holding updated', async () => {
    expect(await fetchInvestmentPrices([2, 1])).toEqual({ ok: true, updated: 1 });
    expect(vi.mocked(fetchAndSave).mock.calls[0]?.[0]).toEqual([
      { id: 1, isin: 'INE000KP0011', feed: 'nse' },
      { id: 2, isin: 'INF000MF0012', feed: 'amfi' },
    ]);
    expect(db.insert).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/investments', 'layout');
  });

  it('rejects missing ISINs and ignores statement values and sold holdings', async () => {
    const result = await fetchInvestmentPrices([3, 4, 5]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Add a valid ISIN/);
    expect(fetchAndSave).not.toHaveBeenCalled();
  });

  it('reports missing published prices without claiming an update', async () => {
    vi.mocked(fetchAndSave).mockResolvedValue({ updated: 0, problems: [], unavailable: false });
    const result = await fetchInvestmentPrices([1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/No new prices were found/);
  });
});
