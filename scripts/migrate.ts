import { loadEnv, openDatabase, databasePath } from '../lib/db/connect.ts';

loadEnv();
const { sqlite } = openDatabase();
sqlite.close();
console.log(`Database up to date: ${databasePath()}`);
