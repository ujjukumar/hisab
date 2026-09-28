import 'server-only';
import { openDatabase, type Connection } from './connect';

/**
 * One shared connection, cached on globalThis so hot reload in development
 * doesn't open a new SQLite handle on every edit.
 * Only lib/queries and lib/actions may import this. Components never do.
 */

const globalForDb = globalThis as unknown as { hisaabDb?: Connection };

const connection = globalForDb.hisaabDb ?? openDatabase();
if (process.env.NODE_ENV !== 'production') globalForDb.hisaabDb = connection;

export const db = connection.db;
export const sqlite = connection.sqlite;
