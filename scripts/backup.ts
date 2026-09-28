import { backupTo, loadEnv, openDatabase } from '../lib/db/connect.ts';

loadEnv();
const { sqlite } = openDatabase({ migrate: false });
const file = backupTo(sqlite);
sqlite.close();
console.log(`Backup written to ${file}`);
