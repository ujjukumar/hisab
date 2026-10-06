import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@/lib/db/schema';
import { unitsAmount, type HoldingTxn } from '@/lib/domain/holdings';
import type { PortfolioData } from '@/lib/domain/portfolio';
import { zip } from '@/lib/zip';
import {
  feedAssets,
  isDue,
  parseAmfiNav,
  parseBhavcopy,
  pastPriceNeeds,
  pendingPriceNeeds,
  pricesFor,
} from '@/lib/domain/priceFeeds';
import { amfiFor, bseLatest, FeedError, listedPricesOn, nseLatest } from '@/lib/feeds';

vi.mock('server-only', () => ({}));

afterEach(() => vi.unstubAllGlobals());

/** PLAN section 11, phase 8. The layouts match AMFI's and NSE's files; every name and number is invented. */

describe('parseAmfiNav', () => {
  it('reads the latest-NAV list, skipping headings, blank lines and N.A.', () => {
    const text = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
      '',
      'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)',
      '',
      'Meridian Mutual Fund',
      '',
      '100001;INF000MF0012;-;Meridian Flexi Cap Fund - Direct Plan - Growth;Direct;Growth;123.4500;26-Sep-2025',
      '100002;INF000MF0020;INF000MF0038;Meridian Flexi Cap Fund - Direct Plan - IDCW;Direct;IDCW;21.0700;26-Sep-2025',
      '100003;INF000MF0046;-;Meridian Closed Fund;Direct;Growth;N.A.;26-Sep-2025',
      '100004;inf000ho0017;-;Harbor Overnight Fund;Direct;Growth;1250.1;29-Feb-2024',
    ].join('\r\n');
    const map = parseAmfiNav(text);
    expect(Object.fromEntries(map)).toEqual({
      INF000MF0012: { date: '2025-09-26', price: '123.45' },
      INF000MF0020: { date: '2025-09-26', price: '21.07' },
      INF000MF0038: { date: '2025-09-26', price: '21.07' },
      INF000HO0017: { date: '2024-02-29', price: '1250.1' },
    });
  });

  it('reads the history report, whose columns are in a different order', () => {
    const text = [
      'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
      '',
      'Saffron Mutual Fund',
      '200001;Saffron Midcap Fund - Direct Growth;Direct;Growth;INF000SM0025;;88.1234;30-Jun-2025',
    ].join('\n');
    expect(Object.fromEntries(parseAmfiNav(text))).toEqual({
      INF000SM0025: { date: '2025-06-30', price: '88.1234' },
    });
  });

  it('returns nothing for a page that is not a NAV list', () => {
    expect(parseAmfiNav('<!DOCTYPE html><html>Service unavailable</html>').size).toBe(0);
    expect(parseAmfiNav('').size).toBe(0);
  });

  it('refuses zero, negative and over-precise NAVs', () => {
    const text = [
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
      '1;INF000AA0011;-;A;0.0000;26-Sep-2025',
      '2;INF000AA0029;-;B;-5.10;26-Sep-2025',
      '3;INF000AA0037;-;C;10.1234567;26-Sep-2025',
      '4;INF000AA0045;-;D;10.5;31-Sep-2025',
    ].join('\n');
    expect(parseAmfiNav(text).size).toBe(0);
  });
});

describe('parseBhavcopy', () => {
  it('reads the UDiFF format and prefers the EQ series', () => {
    const csv = [
      'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,OpnPric,ClsPric,LastPric',
      '2025-09-26,2025-09-26,CM,NSE,STK,1,INE000KP0011,KAVERI,BE,400,401.00,401',
      '2025-09-26,2025-09-26,CM,NSE,STK,1,INE000KP0011,KAVERI,EQ,410,412.35,412',
      '2025-09-26,2025-09-26,CM,NSE,STK,2,INE000SF0019,SAHYADRI,EQ,99,98.05,98',
      '2025-09-26,2025-09-26,CM,NSE,STK,2,INE000SF0019,SAHYADRI,BL,99,97.00,97',
      '2025-09-26,2025-09-26,CM,NSE,STK,3,INF000BN0015,BANYANNIFTY,EQ,250,251.2,251',
      '2025-09-26,2025-09-26,CM,NSE,STK,4,,NOISIN,EQ,1,1,1',
      '',
    ].join('\r\n');
    expect(Object.fromEntries(parseBhavcopy(csv))).toEqual({
      INE000KP0011: { date: '2025-09-26', price: '412.35' },
      INE000SF0019: { date: '2025-09-26', price: '98.05' },
      INF000BN0015: { date: '2025-09-26', price: '251.2' },
    });
  });

  it('reads the older format', () => {
    const csv = [
      'SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN,',
      'KAVERI,EQ,300,310,295,305.5,305,299,1000,305000,28-JUN-2024,40,INE000KP0011,',
    ].join('\n');
    expect(Object.fromEntries(parseBhavcopy(csv))).toEqual({
      INE000KP0011: { date: '2024-06-28', price: '305.5' },
    });
  });

  it('reads BSE UDiFF and prefers A even when a quoted name contains commas', () => {
    const csv = [
      'TradDt,Src,ISIN,FinInstrmNm,SctySrs,ClsPric',
      '2024-07-08,BSE,INE000KP0011,"Company, Inc",T,12.4',
      '2024-07-08,BSE,INE000KP0011,"Company, Inc",A,12.5',
    ].join('\n');
    expect(parseBhavcopy(csv).get('INE000KP0011')).toEqual({ date: '2024-07-08', price: '12.5' });
  });

  it('reads the older BSE equity file with ISIN and trading date', () => {
    expect(parseBhavcopy([
      'SC_CODE,SC_NAME,SC_GROUP,CLOSE,ISIN_CODE,TRADING_DATE',
      '500001,"Example, Ltd",A,100.50,INE000KP0011,05-Jul-24',
    ].join('\n')).get('INE000KP0011')).toEqual({ date: '2024-07-05', price: '100.5' });
  });

  it('returns nothing without the columns it needs', () => {
    expect(parseBhavcopy('Symbol,Close\nKAVERI,10').size).toBe(0);
  });
});

describe('historical downloads', () => {
  it('recognizes a date with no whole-market files from either exchange', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await listedPricesOn('2024-07-08', ['INE000KP0011'])).toEqual({
      prices: new Map(),
      marketFileFound: false,
    });
  });

  it('does not call a published file without the requested ISIN a market closure', async () => {
    const file = zip([{
      name: 'bhavcopy.csv',
      text: 'TradDt,Src,ISIN,SctySrs,ClsPric\n2024-07-08,NSE,INE000SF0019,EQ,90',
    }]);
    vi.stubGlobal('fetch', async (url: string) => url.includes('nsearchives')
      ? new Response(new Uint8Array(file))
      : new Response('', { status: 404 }));
    expect(await listedPricesOn('2024-07-08', ['INE000KP0011'])).toEqual({
      prices: new Map(),
      marketFileFound: true,
    });
  });

  it('only accepts a NAV dated on the requested daily target', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(String(url));
      const date = new URL(String(url)).searchParams.get('frmdt');
      expect(new URL(String(url)).searchParams.get('todt')).toBe(date);
      const nav = [
        'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
        `100001;Invented Fund;Direct;Growth;INF000MF0012;;12;01-Apr-2024`,
      ].join('\n');
      return new Response(date === '01-Apr-2024' || date === '02-Apr-2024' ? nav : '', {
        status: date === '01-Apr-2024' || date === '02-Apr-2024' ? 200 : 404,
      });
    });
    expect(await amfiFor('2024-04-02', ['INF000MF0012'], 1)).toEqual(new Map());
    expect(requested).toHaveLength(1);
    expect((await amfiFor('2024-04-02', ['INF000MF0012'])).get('INF000MF0012')).toEqual({
      date: '2024-04-01',
      price: '12',
    });
  });

  it('does not look for an NFO NAV before its first available date', async () => {
    const isin = 'INF247L01EJ8';
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const date = new URL(String(url)).searchParams.get('frmdt') ?? '';
      requested.push(date);
      const nav = [
        'Scheme Code;Scheme Name;ISIN Div Payout/ ISIN Growth;Net Asset Value;Date',
        `100001;Invented NFO;${isin};10;${date}`,
      ].join('\n');
      return new Response(date === '25-Feb-2025' ? nav : '');
    });

    expect(await amfiFor(
      '2025-03-02',
      [isin],
      7,
      new Map([[isin, '2025-02-25']]),
    )).toEqual(new Map([[isin, { date: '2025-02-25', price: '10' }]]));
    expect(requested).toEqual([
      '02-Mar-2025', '01-Mar-2025', '28-Feb-2025', '27-Feb-2025', '26-Feb-2025', '25-Feb-2025',
    ]);
  });

  it('treats an AMFI HTML error page as unavailable instead of an empty price list', async () => {
    vi.stubGlobal('fetch', async () => new Response(
      '<!doctype html><html><body>Request rejected</body></html>',
      { headers: { 'content-type': 'text/html' } },
    ));
    await expect(amfiFor('2026-10-06', ['INF000MF0012'], 1)).rejects.toThrow(FeedError);
  });

  it('treats a missing daily NSE file as a day without trading', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(String(url));
      return new Response('', { status: 404 });
    });
    expect(await nseLatest('2024-04-02', 1)).toEqual(new Map());
    expect(requests).toHaveLength(2);
  });

  it('treats a week without either market file as missing data, not a stopped backfill', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(String(url));
      return new Response('', { status: 404 });
    });
    expect(await nseLatest('2024-07-07', 7)).toEqual(new Map());
    expect(await bseLatest('2024-07-07', 7)).toEqual(new Map());
    expect(requests.every((url) => !url.includes('INE000KP0011'))).toBe(true);
  });

  it('downloads BSE market files without ISINs in the URL across the format boundary', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(urls.length === 1
        ? 'TradDt,Src,ISIN,SctySrs,ClsPric\n2024-07-08,BSE,INE000KP0011,A,50'
        : 'ISIN_CODE,SC_GROUP,CLOSE,TRADING_DATE\nINE000KP0011,A,45,05-Jul-24');
    });
    expect((await bseLatest('2024-07-08', 1)).get('INE000KP0011')?.price).toBe('50');
    expect((await bseLatest('2024-07-05', 1)).get('INE000KP0011')?.price).toBe('45');
    expect(urls).toEqual([
      'https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_20240708_F_0000.CSV',
      'https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_050724.CSV',
    ]);
  });

  it('skips BSE HTML sent with status 200 for unpublished dates, including during weekly lookback', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(String(url).includes('20260930')
        ? 'TradDt,Src,ISIN,SctySrs,ClsPric\n2026-09-30,BSE,INE000KP0011,A,50'
        : '<!DOCTYPE html><html><title>Archive unavailable</title></html>', { status: 200 });
    });
    expect(await bseLatest('2026-10-01', 1)).toEqual(new Map());
    expect((await bseLatest('2026-10-01', 7)).get('INE000KP0011')).toEqual({
      date: '2026-09-30', price: '50',
    });
    expect(urls).toHaveLength(3);
  });

  it('searches older market files until each requested ISIN has a quote', async () => {
    const target = 'INE000KP0011';
    const other = 'INE000SF0019';
    const nseRequests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      nseRequests.push(String(url));
      const day = String(url).match(/_(2024070[89])_F_0000\.csv\.zip/)?.[1];
      if (url.includes('nsearchives') && day) {
        const isin = day === '20240709' ? other : target;
        const price = day === '20240709' ? '20' : '18';
        const csv = `TradDt,Src,ISIN,SctySrs,ClsPric\n2024-07-${day.slice(-2)},NSE,${isin},EQ,${price}`;
        return new Response(new Uint8Array(zip([{ name: 'bhavcopy.csv', text: csv }])));
      }
      if (url.includes('nsearchives')) return new Response('', { status: 404 });
      const date = String(url).includes('20240709') ? '2024-07-09' : '2024-07-08';
      const isin = date === '2024-07-09' ? other : target;
      const price = date === '2024-07-09' ? '20' : '18';
      return new Response(`TradDt,Src,ISIN,SctySrs,ClsPric\n${date},BSE,${isin},A,${price}`);
    });

    expect(await nseLatest('2024-07-09', 2, [target])).toEqual(new Map([
      [target, { date: '2024-07-08', price: '18' }],
    ]));
    expect(await bseLatest('2024-07-09', 2, [target])).toEqual(new Map([
      [target, { date: '2024-07-08', price: '18' }],
    ]));
    expect(nseRequests.filter((url) => url.includes('nsearchives'))).toHaveLength(2);
  });

  it('still rejects a non-HTML BSE file with invalid columns', async () => {
    vi.stubGlobal('fetch', async () => new Response('not,a,bhavcopy\n1,2,3', { status: 200 }));
    await expect(bseLatest('2026-09-30', 1)).rejects.toThrow("BSE's closing prices couldn't be read");
  });
});

describe('isDue', () => {
  it('checks once a calendar day', () => {
    expect(isDue(null, '2026-10-01')).toBe(true);
    expect(isDue('2026-09-30', '2026-10-01')).toBe(true);
    expect(isDue('2026-10-01', '2026-10-01')).toBe(false);
    expect(isDue('2024-12-31', '2025-01-01')).toBe(true);
  });
});

const asset = (
  id: number,
  type: Asset['type'],
  symbol: string | null,
  valuation: Asset['valuation'] = 'units',
): Asset => ({
  id,
  name: `Invented ${id}`,
  type,
  assetClass: 'equity',
  valuation,
  symbol,
  navStartDate: null,
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

const trade = (
  id: number,
  assetId: number,
  date: string,
  action: 'buy' | 'sell',
  units: string,
): HoldingTxn & { assetId: number } => ({
  id,
  assetId,
  date,
  action,
  units,
  price: '10',
  amount: unitsAmount(units, '10'),
  fees: 0,
  splitFrom: null,
  splitTo: null,
});

describe('feedAssets and pricesFor', () => {
  const assets = [
    asset(1, 'mutual_fund', ' inf000mf0012 '),
    asset(2, 'stock', 'INE000KP0011'),
    asset(3, 'etf', 'INF000BN0015'),
    asset(4, 'mutual_fund', 'MERIDIAN'),
    asset(5, 'gold', 'INF000GD0010'),
    asset(6, 'mutual_fund', 'INF000MF0020', 'manual'),
    asset(7, 'stock', null),
  ];

  it('links only unit-priced funds, stocks and ETFs whose symbol is an ISIN', () => {
    expect(feedAssets(assets)).toEqual([
      { id: 1, isin: 'INF000MF0012', feed: 'amfi' },
      { id: 2, isin: 'INE000KP0011', feed: 'nse' },
      { id: 3, isin: 'INF000BN0015', feed: 'nse' },
    ]);
  });

  it('pairs each linked investment with its price, leaving out ISINs the file lacks', () => {
    const map = new Map([
      ['INF000MF0012', { date: '2025-09-26', price: '123.45' }],
      ['INE000ZZ0019', { date: '2025-09-26', price: '1' }],
    ]);
    expect(pricesFor(feedAssets(assets), map)).toEqual([
      { assetId: 1, date: '2025-09-26', price: '123.45' },
    ]);
  });
});

describe('pastPriceNeeds', () => {
  const data: PortfolioData = {
    assets: [
      asset(1, 'mutual_fund', 'INF000MF0012'),
      asset(2, 'stock', 'INE000KP0011'),
      asset(3, 'mutual_fund', null),
    ],
    txns: [
      trade(1, 1, '2024-01-10', 'buy', '10'),
      trade(2, 2, '2024-02-05', 'buy', '5'),
      trade(3, 2, '2024-03-20', 'sell', '5'),
      trade(4, 3, '2023-06-01', 'buy', '1'),
    ],
    prices: [
      // A price three days before the February month-end covers it (29 Feb, leap year).
      { assetId: 1, date: '2024-02-26', price: '11' },
      { assetId: 1, date: '2024-03-10', price: '11' },
    ],
    valuations: [],
  };

  it('requests every missing weekday from the first purchase date', () => {
    const recent: PortfolioData = {
      ...data,
      assets: [asset(1, 'mutual_fund', 'INF000MF0012')],
      txns: [trade(1, 1, '2024-02-01', 'buy', '1')],
      prices: [
        { assetId: 1, date: '2024-03-26', price: '11' },
        { assetId: 1, date: '2024-04-29', price: '12' },
      ],
    };
    const needs = pastPriceNeeds(recent, '2024-04-30').map((need) => need.date);
    expect(needs[0]).toBe('2024-02-01');
    expect(needs.filter((date) => date >= '2024-04-01')).toEqual([
      '2024-04-01', '2024-04-02', '2024-04-03', '2024-04-04', '2024-04-05',
      '2024-04-08', '2024-04-09', '2024-04-10', '2024-04-11', '2024-04-12',
      '2024-04-15', '2024-04-16', '2024-04-17', '2024-04-18', '2024-04-19',
      '2024-04-22', '2024-04-23', '2024-04-24', '2024-04-25', '2024-04-26',
      '2024-04-30',
    ]);
    expect(needs).toContain('2024-03-25');
    expect(needs).not.toContain('2024-03-31');
    expect(needs).toContain('2024-02-29');
  });

  it('keeps historical weekdays while extending the end date', () => {
    const held: PortfolioData = {
      ...data,
      txns: [trade(1, 1, '2024-01-01', 'buy', '1')],
      prices: [],
    };
    const dates = (asOf: string) => pastPriceNeeds(held, asOf).map((need) => need.date);
    expect(dates('2024-04-30')).toContain('2024-03-11');
    expect(dates('2024-04-30')).toContain('2024-03-15');
    expect(dates('2024-04-30')).not.toContain('2024-03-16');
    expect(dates('2024-05-01').slice(0, dates('2024-04-30').length)).toEqual(dates('2024-04-30'));
  });

  it('skips weekdays before an NFO first-NAV date', () => {
    const nfo: PortfolioData = {
      ...data,
      assets: [{ ...asset(1, 'mutual_fund', 'INF247L01EJ8'), navStartDate: '2025-02-25' }],
      txns: [trade(1, 1, '2025-02-12', 'buy', '10')],
      prices: [],
    };
    const needs = pastPriceNeeds(nfo, '2025-04-01');
    expect(needs.find((need) => need.date === '2025-02-24')).toBeUndefined();
    expect(needs.find((need) => need.date === '2025-02-25')?.linked.map((item) => item.id)).toEqual([1]);
  });

  it('rechecks newly linked investments without retrying earlier failed prices in the same run', () => {
    const first: PortfolioData = {
      assets: [asset(1, 'mutual_fund', 'INF000MF0012')],
      txns: [trade(1, 1, '2024-04-01', 'buy', '1')],
      prices: [],
      valuations: [],
    };
    const date = '2024-04-02';
    const attempted = new Set([`${date}:daily:1`]);
    expect(pendingPriceNeeds(first, date, attempted).find((n) => n.date === date)).toBeUndefined();
    const added: PortfolioData = {
      ...first,
      assets: [...first.assets, asset(2, 'stock', 'INE000KP0011')],
      txns: [...first.txns, trade(2, 2, '2024-04-01', 'buy', '1')],
    };
    expect(pendingPriceNeeds(added, date, attempted).find((n) => n.date === date)?.linked.map((a) => a.id))
      .toEqual([2]);
  });

  it('skips exact-price dates and assets after they are sold', () => {
    const needs = pastPriceNeeds(data, '2024-04-30');
    const ids = (date: string) => needs.find((need) => need.date === date)?.linked.map((a) => a.id);
    expect(ids('2024-02-26')).toEqual([2]);
    expect(ids('2024-03-11')).toEqual([1, 2]);
    expect(ids('2024-03-21')).toEqual([1]);
    expect(ids('2024-04-01')).toEqual([1]);
    expect(ids('2024-04-29')).toEqual([1]);
  });

  it('skips dates learned to have no whole-market files', () => {
    const listed: PortfolioData = {
      ...data,
      assets: [asset(2, 'stock', 'INE000KP0011')],
      txns: [trade(2, 2, '2024-02-05', 'buy', '5')],
      prices: [],
    };
    expect(pastPriceNeeds(listed, '2024-02-28').some((need) => need.date === '2024-02-26')).toBe(true);
    expect(pastPriceNeeds(listed, '2024-02-28', new Set(['2024-02-26']))
      .some((need) => need.date === '2024-02-26')).toBe(false);
  });

  it('is empty when nothing is linked or nothing was bought', () => {
    expect(pastPriceNeeds({ ...data, txns: [] }, '2024-04-30')).toEqual([]);
    expect(pastPriceNeeds({ ...data, assets: [asset(3, 'mutual_fund', null)] }, '2024-04-30')).toEqual(
      [],
    );
  });

  it('crosses the year end', () => {
    const late: PortfolioData = {
      ...data,
      txns: [trade(1, 1, '2024-12-02', 'buy', '1')],
      prices: [],
    };
    const needs = pastPriceNeeds(late, '2025-01-31');
    expect(needs[0]?.date).toBe('2024-12-02');
    expect(needs.find((need) => need.date === '2024-12-30')?.cadence).toBe('daily');
    expect(needs.find((need) => need.date === '2025-01-02')?.cadence).toBe('daily');
    expect(needs.at(-1)?.date).toBe('2025-01-31');
    expect(needs.map((need) => need.date)).not.toContain('2025-01-04');
  });
});
