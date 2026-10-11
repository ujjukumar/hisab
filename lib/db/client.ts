import 'server-only';
import { hasPendingMigrations, openDatabase, type Connection } from './connect';
// Imported so a schema change (such as a pull that adds a migration) re-runs the check below on hot reload.
import './schema';

/**
 * One shared connection, cached on globalThis so hot reload in development
 * doesn't open a new SQLite handle on every edit.
 * Only lib/queries and lib/actions may import this. Components never do.
 */

const globalForDb = globalThis as unknown as { hisaabDb?: Connection };

// Migrations run only when the connection opens, so one added after `npm run dev`
// started would otherwise surface as a missing-column error.
if (globalForDb.hisaabDb && hasPendingMigrations(globalForDb.hisaabDb.sqlite)) {
  throw new Error('New database migrations were added. Restart npm run dev to apply them.');
}

const connection = globalForDb.hisaabDb ?? openDatabase();
if (process.env.NODE_ENV !== 'production') globalForDb.hisaabDb = connection;

export const db = connection.db;
export const sqlite = connection.sqlite;
