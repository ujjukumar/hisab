import { ensureDefaults, loadEnv, openDatabase, wipeAll } from '../lib/db/connect.ts';

/** Wipe every table and recreate the default categories. Requires --yes. */

if (!process.argv.includes('--yes')) {
  console.error('This deletes all data. Run: npm run reset -- --yes');
  process.exit(1);
}

loadEnv();
const { sqlite } = openDatabase();
wipeAll(sqlite);
ensureDefaults(sqlite);
sqlite.close();
console.log('All data removed. Default categories recreated.');
