import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@/lib/db/schema';
import { openDatabase } from '@/lib/db/connect';
import type { PortfolioData } from '@/lib/domain/portfolio';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return connection.db;
  },
}));
vi.mock('@/lib/queries/investments', () => ({ freshPortfolioData: vi.fn() }));
vi.mock('@/lib/actions/priceDownloads', () => ({ fetchAndSave: vi.fn() }));
vi.mock('@/lib/feeds', () => ({ amfiFor: vi.fn() }));
vi.mock('@/lib/domain/dates', async (original) => ({
  ...(await original<typeof import('@/lib/domain/dates')>()),
  today: () => '2024-04-02',
}));

const folder = mkdtempSync(join(tmpdir(), 'hisaab-worker-'));
const priorPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(folder, 'invented.db');
const connection = openDatabase();

afterAll(() => {
  connection.sqlite.close();
  if (priorPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = priorPath;
  rmSync(folder, { recursive: true, force: true });
});

const asset: Asset = {
  id: 1,
  name: 'Invented holding',
  type: 'stock',
  assetClass: 'equity',
  valuation: 'units',
  symbol: 'INE000KP0011',
  accountRef: null,
  interestRate: null,
  compounding: null,
  startDate: null,
  maturityDate: null,
  note: null,
  archived: 0,
  createdAt: '',
  updatedAt: '',
};
const portfolio: PortfolioData = {
  assets: [asset],
  txns: [
    {
      id: 1,
      assetId: 1,
      date: '2024-04-01',
      action: 'buy',
      units: '1',
      price: '10',
      amount: 1000,
      fees: 0,
      splitFrom: null,
      splitTo: null,
    },
  ],
  prices: [],
  valuations: [],
};

describe('price backfill worker', () => {
  it('stops an in-flight download and retries outstanding dates on a fresh run', async () => {
    const { freshPortfolioData } = await import('@/lib/queries/investments');
    const { fetchAndSave } = await import('@/lib/actions/priceDownloads');
    const { startPriceJob, stopPriceJob, priceJobStatus } = await import('@/lib/actions/priceJob');
    vi.mocked(freshPortfolioData).mockReturnValue(portfolio);
    type Result = { updated: number; problems: string[]; unavailable: boolean };
    let finishDownload: (result: Result) => void = () => {};
    const download = new Promise<Result>((resolve) => {
      finishDownload = resolve;
    });
    vi.mocked(fetchAndSave)
      .mockImplementationOnce(() => download)
      .mockResolvedValue({ updated: 1, problems: [], unavailable: false });

    expect((await startPriceJob())?.state).toBe('running');
    await vi.waitFor(() => expect(fetchAndSave).toHaveBeenCalledTimes(1));
    expect((await stopPriceJob())?.state).toBe('stopping');
    finishDownload({ updated: 0, problems: [], unavailable: false });
    await vi.waitFor(async () => expect((await priceJobStatus())?.state).toBe('stopped'));
    expect((await startPriceJob())?.state).toBe('running');
    await vi.waitFor(async () => expect((await priceJobStatus())?.state).toBe('done'));
    expect(fetchAndSave).toHaveBeenCalledTimes(3);
    expect((await priceJobStatus())?.updated).toBe(2);
  });

  it('resumes a dead worker at its saved checkpoint when status is requested', async () => {
    const { freshPortfolioData } = await import('@/lib/queries/investments');
    const { fetchAndSave } = await import('@/lib/actions/priceDownloads');
    const { writePriceJob } = await import('@/lib/actions/priceJobStore');
    const { priceJobStatus } = await import('@/lib/actions/priceJob');
    vi.mocked(freshPortfolioData).mockReturnValue(portfolio);
    vi.mocked(fetchAndSave)
      .mockClear()
      .mockResolvedValue({ updated: 1, problems: [], unavailable: false });
    writePriceJob(connection.db, {
      id: 'recovered-run',
      state: 'running',
      attempted: ['2024-04-01:daily:1'],
      done: 1,
      total: 2,
      date: '2024-04-02',
      updated: 1,
      message: '',
      owner: 'former-process',
      pid: 99999999,
      heartbeat: '2024-04-01T00:00:00.000Z',
    });
    expect((await priceJobStatus())?.state).toBe('running');
    await vi.waitFor(async () => expect((await priceJobStatus())?.state).toBe('done'));
    expect(fetchAndSave).toHaveBeenCalledTimes(1);
    expect((await priceJobStatus())?.updated).toBe(2);
  });
});
