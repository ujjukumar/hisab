export type BenchmarkIndex = {
  /** Stored with the benchmark, so the source's ticker can change without losing the choice. */
  code: string;
  name: string;
  /** Where the index is from, shown under its name. */
  market: string;
  region: 'india' | 'world';
  /** Yahoo Finance's ticker for the index. */
  symbol: string;
};

/** The stock market indices a benchmark can follow. Levels are in each index's own currency. */
export const BENCHMARK_INDICES: readonly BenchmarkIndex[] = [
  { code: 'nifty50', name: 'Nifty 50', market: 'India', region: 'india', symbol: '^NSEI' },
  { code: 'sensex', name: 'Sensex', market: 'India', region: 'india', symbol: '^BSESN' },
  { code: 'sp500', name: 'S&P 500', market: 'United States', region: 'world', symbol: '^GSPC' },
  { code: 'nasdaq', name: 'Nasdaq Composite', market: 'United States', region: 'world', symbol: '^IXIC' },
  { code: 'dow', name: 'Dow Jones', market: 'United States', region: 'world', symbol: '^DJI' },
  { code: 'ftse100', name: 'FTSE 100', market: 'United Kingdom', region: 'world', symbol: '^FTSE' },
  { code: 'dax', name: 'DAX', market: 'Germany', region: 'world', symbol: '^GDAXI' },
  { code: 'eurostoxx50', name: 'Euro Stoxx 50', market: 'Eurozone', region: 'world', symbol: '^STOXX50E' },
  { code: 'nikkei225', name: 'Nikkei 225', market: 'Japan', region: 'world', symbol: '^N225' },
  { code: 'hangseng', name: 'Hang Seng', market: 'Hong Kong', region: 'world', symbol: '^HSI' },
  { code: 'shanghai', name: 'Shanghai Composite', market: 'China', region: 'world', symbol: '000001.SS' },
  { code: 'bovespa', name: 'Ibovespa', market: 'Brazil', region: 'world', symbol: '^BVSP' },
];

export const MAX_BENCHMARKS = 8;

export function benchmarkIndex(code: string): BenchmarkIndex | undefined {
  return BENCHMARK_INDICES.find((item) => item.code === code);
}
