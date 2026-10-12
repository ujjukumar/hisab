import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBenchmarkPrices, applyFeedPrices } from '@/lib/actions/applyPrices';
import { fetchAndSave } from '@/lib/actions/priceDownloads';
import { bseLatest, FeedError, listedPricesOn, nseLatest } from '@/lib/feeds';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/actions/applyPrices', () => ({
  applyFeedPrices: vi.fn((_db, rows: unknown[]) => rows.length),
  applyBenchmarkPrices: vi.fn((_db, rows: unknown[]) => rows.length),
}));
vi.mock('@/lib/feeds', () => ({
  FeedError: class FeedError extends Error {},
  nseLatest: vi.fn(),
  bseLatest: vi.fn(),
  listedPricesOn: vi.fn(),
}));

const linked = [
  { id: 1, isin: 'INE000KP0011', feed: 'nse' as const },
  { id: 2, isin: 'INE000SF0019', feed: 'nse' as const },
];

beforeEach(() => vi.clearAllMocks());

describe('listed price fallback', () => {
  it('shares an AMFI download with benchmarks and records settled missing NAVs', async () => {
    const benchmark = [{ id: 7, isin: 'INF000BM0011' }, { id: 8, isin: 'INF000BM0029' }];
    const funds = vi.fn(async () => new Map([
      ['INF000BM0011', { date: '2024-04-01', price: '12' }],
    ]));
    const result = await fetchAndSave([], '2024-04-01', funds, 1, () => true, true, benchmark);
    expect(funds).toHaveBeenCalledOnce();
    expect(result.updated).toBe(2);
    expect(vi.mocked(applyBenchmarkPrices).mock.calls[0]?.[1]).toEqual([
      { benchmarkId: 7, date: '2024-04-01', price: '12' },
      { benchmarkId: 8, date: '2024-04-01', price: null },
    ]);
  });

  it('marks a pre-launch NAV missing only when the market file exists, ignoring stale NAVs', async () => {
    const benchmark = [{ id: 7, isin: 'INF000BM0011' }];
    const published = new Map([
      ['INF000BM0011', { date: '2024-03-29', price: '10' }],
      ['INF000MF0012', { date: '2024-04-01', price: '15' }],
    ]);
    const result = await fetchAndSave([], '2024-04-01', async () => published, 1,
      () => true, true, benchmark);
    expect(result.updated).toBe(1);
    expect(vi.mocked(applyBenchmarkPrices).mock.calls[0]?.[1]).toEqual([
      { benchmarkId: 7, date: '2024-04-01', price: null },
    ]);
    vi.clearAllMocks();
    await fetchAndSave([], '2024-04-01', async () => new Map(), 1,
      () => true, true, benchmark);
    expect(applyBenchmarkPrices).not.toHaveBeenCalled();
  });
  it('classifies closed dates only when neither exchange publishes a file', async () => {
    vi.mocked(listedPricesOn).mockResolvedValue({ prices: new Map(), marketFileFound: false });
    const closed = await fetchAndSave(linked, '2024-07-08', async () => new Map(), 1, () => true, true);
    expect(closed).toMatchObject({ noMarketFile: true, problems: [], unavailable: false });

    vi.mocked(listedPricesOn).mockResolvedValue({ prices: new Map(), marketFileFound: true });
    const absentIsin = await fetchAndSave(linked, '2024-07-08', async () => new Map(), 1, () => true, true);
    expect(absentIsin.noMarketFile).toBe(false);
    expect(absentIsin.problems).toEqual(['No exchange price was found for 2 investments. Check the ISIN.']);
  });

  it('keeps the NSE price for dual-listed shares and adds a BSE-only share', async () => {
    vi.mocked(nseLatest).mockResolvedValue(
      new Map([[linked[0]!.isin, { date: '2024-07-08', price: '100' }]]),
    );
    vi.mocked(bseLatest).mockResolvedValue(
      new Map([
        [linked[0]!.isin, { date: '2024-07-08', price: '999' }],
        [linked[1]!.isin, { date: '2024-07-08', price: '80' }],
      ]),
    );
    expect(await fetchAndSave(linked, '2024-07-08', async () => new Map(), 1)).toMatchObject({
      updated: 2,
      problems: [],
    });
    expect(bseLatest).toHaveBeenCalledWith('2024-07-08', 1, ['INE000SF0019']);
    expect(vi.mocked(applyFeedPrices).mock.calls[0]?.[1]).toEqual([
      { assetId: 1, date: '2024-07-08', price: '100' },
      { assetId: 2, date: '2024-07-08', price: '80' },
    ]);
  });

  it('does not download BSE when all linked ISINs are on NSE', async () => {
    vi.mocked(nseLatest).mockResolvedValue(
      new Map(linked.map((asset) => [asset.isin, { date: '2024-07-08', price: '10' }])),
    );
    await fetchAndSave(linked, '2024-07-08', async () => new Map());
    expect(bseLatest).not.toHaveBeenCalled();
  });

  it('records a missing week without treating unpublished market files as a network failure', async () => {
    vi.mocked(nseLatest).mockResolvedValue(new Map());
    vi.mocked(bseLatest).mockResolvedValue(new Map());
    expect(await fetchAndSave(linked, '2024-07-07', async () => new Map(), 7)).toMatchObject({
      updated: 0,
      unavailable: false,
      problems: ['NSE and BSE had no closing prices for this week. Run again later to retry.'],
    });
  });

  it('uses BSE when NSE fails but the BSE-only close is available', async () => {
    vi.mocked(nseLatest).mockRejectedValue(new FeedError('NSE unavailable'));
    vi.mocked(bseLatest).mockResolvedValue(
      new Map(linked.map((asset) => [asset.isin, { date: '2024-07-08', price: '80' }])),
    );
    expect(await fetchAndSave(linked, '2024-07-08', async () => new Map(), 1)).toMatchObject({
      updated: 2,
      unavailable: false,
      problems: [],
    });
  });

  it('does not save downloaded rows after Stop', async () => {
    vi.mocked(nseLatest).mockResolvedValue(
      new Map(linked.map((asset) => [asset.isin, { date: '2024-07-08', price: '80' }])),
    );
    expect(
      await fetchAndSave(
        linked,
        '2024-07-08',
        async () => new Map(),
        1,
        () => false,
      ),
    ).toMatchObject({ updated: 0 });
    expect(applyFeedPrices).not.toHaveBeenCalled();
  });
});
