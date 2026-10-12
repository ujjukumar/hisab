export type SuggestedBenchmark = { name: string; fund: string; isin: string };

/** Long-running direct-growth index funds, so comparisons reach far back. ISINs from AMFI's NAV file, Oct 2026. */
export const SUGGESTED_BENCHMARKS: readonly SuggestedBenchmark[] = [
  { name: 'Nifty 50', fund: 'UTI Nifty 50 Index Fund', isin: 'INF789F01XA0' },
  { name: 'Sensex', fund: 'HDFC BSE Sensex Index Fund', isin: 'INF179K01WN9' },
  { name: 'Nifty Next 50', fund: 'ICICI Prudential Nifty Next 50 Index Fund', isin: 'INF109K01Y80' },
  { name: 'Nifty Midcap 150', fund: 'Motilal Oswal Nifty Midcap 150 Index Fund', isin: 'INF247L01916' },
  { name: 'Nifty Smallcap 250', fund: 'Motilal Oswal Nifty Smallcap 250 Index Fund', isin: 'INF247L01932' },
  { name: 'Nifty 500', fund: 'Motilal Oswal Nifty 500 Index Fund', isin: 'INF247L01957' },
];
