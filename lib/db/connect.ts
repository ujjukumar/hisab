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
  // The path is only known at runtime, so tell the bundler not to trace the whole project for it.
  return resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH ?? './data/finance.db');
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

function countKnownMigrations(): number {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
  if (!existsSync(journalPath)) return 0;
  return (JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }).entries.length;
}

function countPendingMigrations(db: Database.Database): number {
  return Math.max(0, countKnownMigrations() - countAppliedMigrations(db));
}

/** Every app table, children before parents, so deleting in this order respects foreign keys. */
export const TABLES = [
  'transactions',
  'investment_transactions',
  'prices',
  'valuations',
  'budgets',
  'assets',
  'categories',
  'accounts',
  'settings',
] as const;

/** Delete every row and restart the ids. Call `ensureDefaults` afterwards. */
export function wipeAll(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    for (const table of TABLES) sqlite.prepare(`DELETE FROM ${table}`).run();
    sqlite.prepare('DELETE FROM sqlite_sequence').run();
  })();
}

/** A backup that can't be restored. The message is shown to the owner as is. */
export class BackupError extends Error {}

const NOT_A_BACKUP =
  "That file isn't a Hisaab backup. Choose a .db file from the data/backups folder.";

/**
 * Check that a file is a readable Hisaab backup and bring it up to this version's tables.
 * Changes the file, so pass a temporary copy.
 */
export function prepareBackup(file: string): void {
  const header = readFileSync(file).subarray(0, 16).toString('latin1');
  if (header !== 'SQLite format 3\0') throw new BackupError(NOT_A_BACKUP);
  const backup = new Database(file);
  try {
    if (backup.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new BackupError('That backup is damaged, so nothing was changed. Try an older one.');
    }
    const names = new Set(
      (
        backup.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    if (!names.has('__drizzle_migrations') || !TABLES.every((t) => names.has(t))) {
      throw new BackupError(NOT_A_BACKUP);
    }
    if (countAppliedMigrations(backup) > countKnownMigrations()) {
      throw new BackupError(
        'That backup is from a newer version of Hisaab. Update the app, then try again.',
      );
    }
    migrate(drizzle(backup, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    if ((backup.pragma('foreign_key_check') as unknown[]).length > 0) {
      throw new BackupError('That backup is damaged, so nothing was changed. Try an older one.');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(NOT_A_BACKUP);
  } finally {
    backup.close();
  }
}

/** Replace every row with the rows of a prepared backup, all in one transaction. */
export function restoreFrom(sqlite: Database.Database, file: string): void {
  sqlite.prepare('ATTACH DATABASE ? AS backup').run(file);
  try {
    sqlite.transaction(() => {
      // Tables are refilled parents first, but a link can point either way, so check keys at commit.
      sqlite.pragma('defer_foreign_keys = ON');
      for (const table of TABLES) sqlite.prepare(`DELETE FROM main.${table}`).run();
      for (const table of [...TABLES].reverse()) {
        sqlite.prepare(`INSERT INTO main.${table} SELECT * FROM backup.${table}`).run();
      }
      sqlite.prepare('DELETE FROM main.sqlite_sequence').run();
      sqlite.prepare('INSERT INTO main.sqlite_sequence SELECT * FROM backup.sqlite_sequence').run();
    })();
  } finally {
    sqlite.prepare('DETACH DATABASE backup').run();
  }
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
