import { ensureDefaults, loadEnv, openDatabase } from '../lib/db/connect.ts';

/** Wipe every table and recreate the default categories. Requires --yes. */

if (!process.argv.includes('--yes')) {
  console.error('This deletes all data. Run: npm run reset -- --yes');
  process.exit(1);
}

loadEnv();
const { sqlite } = openDatabase();

// Child tables first: foreign keys are on.
const TABLES = [
  'transactions',
  'investment_transactions',
  'prices',
  'valuations',
  'budgets',
  'assets',
  'categories',
  'accounts',
  'settings',
];

sqlite.transaction(() => {
  for (const table of TABLES) sqlite.prepare(`DELETE FROM ${table}`).run();
  sqlite.prepare(`DELETE FROM sqlite_sequence`).run();
})();

ensureDefaults(sqlite);
sqlite.close();
console.log('All data removed. Default categories recreated.');
