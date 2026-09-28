import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
// Explicit .ts extensions: the scripts in scripts/ import this file under plain Node ESM.
import * as schema from './schema.ts';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './defaults.ts';

/**
 * The connection itself. `lib/db/client.ts` is the server-only wrapper the app uses;
 * the scripts in `scripts/` import this file directly because they run in plain Node.
 */

export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'lib/db/migrations');

export function databasePath(): string {
  return resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/finance.db');
}

export function backupsFolder(): string {
  return resolve(dirname(databasePath()), 'backups');
}

function timestamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** VACUUM INTO a copy. Returns the file written. */
export function backupTo(db: Database.Database, folder = backupsFolder(), label = ''): string {
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, `finance-${timestamp()}${label}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

function countAppliedMigrations(db: Database.Database): number {
  const row = db
    .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get() as { n: number };
  if (row.n === 0) return 0;
  return (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
}

function countPendingMigrations(db: Database.Database): number {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
  if (!existsSync(journalPath)) return 0;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  return Math.max(0, journal.entries.length - countAppliedMigrations(db));
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export type Connection = { db: Db; sqlite: Database.Database };

/** Open the database, set pragmas, apply pending migrations (after a backup) and seed defaults. */
export function openDatabase(options: { migrate?: boolean } = {}): Connection {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  if (options.migrate !== false) {
    const pending = countPendingMigrations(sqlite);
    if (pending > 0) {
      // Only worth backing up if there is already data to lose.
      if (countAppliedMigrations(sqlite) > 0) backupTo(sqlite, backupsFolder(), '-pre-migrate');
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    }
    ensureDefaults(sqlite);
  }

  return { db, sqlite };
}

/** Default categories and settings. Safe to call on every start; it only fills gaps. */
export function ensureDefaults(sqlite: Database.Database): void {
  const insertCategory = sqlite.prepare(
    `INSERT OR IGNORE INTO categories (name, kind, color, sort_order) VALUES (?, ?, ?, ?)`,
  );
  const insertSetting = sqlite.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  );
  sqlite.transaction(() => {
    DEFAULT_CATEGORIES.forEach((c, i) => insertCategory.run(c.name, c.kind, c.color, i));
    for (const s of DEFAULT_SETTINGS) insertSetting.run(s.key, s.value);
  })();
}

/** Load .env for the scripts. Next.js does this itself. */
export function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env'));
  } catch {
    // No .env file; DATABASE_PATH falls back to ./data/finance.db.
  }
}
