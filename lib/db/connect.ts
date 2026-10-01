import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
// Explicit .ts extensions: the scripts in scripts/ import this file under plain Node ESM.
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './defaults.ts';
import { withTransaction } from './transaction.ts';

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
export function backupTo(db: DatabaseSync, folder = backupsFolder(), label = ''): string {
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, `finance-${timestamp()}${label}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

function migrationFiles(): { name: string; hashes: string[] }[] {
  return readdirSync(MIGRATIONS_FOLDER)
    .filter((name) => existsSync(resolve(MIGRATIONS_FOLDER, name, 'migration.sql')))
    .sort()
    .map((name) => {
      const sql = readFileSync(resolve(MIGRATIONS_FOLDER, name, 'migration.sql'), 'utf8');
      const lf = sql.replaceAll('\r\n', '\n');
      return {
        name,
        hashes: [sql, lf, lf.replaceAll('\n', '\r\n')].map((text) =>
          createHash('sha256').update(text).digest('hex'),
        ),
      };
    });
}

function migrationState(sqlite: DatabaseSync): { needsMigration: boolean; hasApplied: boolean } {
  const files = migrationFiles();
  if (files.length === 0) throw new Error('No database migrations were found.');
  const history = sqlite.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  ).get();
  if (!history) {
    const existing = sqlite.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1`,
    ).get();
    if (existing) throw new Error('Database tables exist without migration history. No changes were made.');
    return { needsMigration: true, hasApplied: false };
  }

  const columns = sqlite.prepare('PRAGMA table_info(__drizzle_migrations)').all() as { name: string }[];
  const legacy = !columns.some((column) => column.name === 'name');
  const applied = sqlite.prepare(
    `SELECT hash, ${legacy ? 'NULL AS name' : 'name'} FROM __drizzle_migrations ORDER BY id`,
  ).all() as { hash: string; name: string | null }[];
  if (applied.length > files.length) {
    throw new Error('This database was migrated by a newer Hisaab version. Update the app before opening it.');
  }
  if (applied.length === 0 && TABLES.some((table) =>
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table))) {
    throw new Error('Database tables exist without applied migrations. No changes were made.');
  }
  for (const [index, row] of applied.entries()) {
    if (!files[index]!.hashes.includes(row.hash) || (!legacy && row.name !== files[index]!.name)) {
      throw new Error('Database migration history does not match this app. No changes were made.');
    }
  }
  return { needsMigration: legacy || applied.length < files.length, hasApplied: applied.length > 0 };
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
export function wipeAll(sqlite: DatabaseSync): void {
  withTransaction(sqlite, () => {
    for (const table of TABLES) sqlite.prepare(`DELETE FROM ${table}`).run();
    sqlite.prepare('DELETE FROM sqlite_sequence').run();
  });
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
  const backup = new DatabaseSync(file);
  try {
    if ((backup.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') {
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
    const appliedCount = (backup.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
    if (appliedCount > migrationFiles().length) {
      throw new BackupError(
        'That backup is from a newer version of Hisaab. Update the app, then try again.',
      );
    }
    const state = migrationState(backup);
    if (state.needsMigration) {
      migrate(drizzle({ client: backup }), { migrationsFolder: MIGRATIONS_FOLDER });
    }
    if (backup.prepare('PRAGMA foreign_key_check').all().length > 0) {
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
export function restoreFrom(sqlite: DatabaseSync, file: string): void {
  sqlite.prepare('ATTACH DATABASE ? AS backup').run(file);
  try {
    withTransaction(sqlite, () => {
      // Tables are refilled parents first, but a link can point either way, so check keys at commit.
      sqlite.exec('PRAGMA defer_foreign_keys = ON');
      for (const table of TABLES) sqlite.prepare(`DELETE FROM main.${table}`).run();
      for (const table of [...TABLES].reverse()) {
        sqlite.prepare(`INSERT INTO main.${table} SELECT * FROM backup.${table}`).run();
      }
      sqlite.prepare('DELETE FROM main.sqlite_sequence').run();
      sqlite.prepare('INSERT INTO main.sqlite_sequence SELECT * FROM backup.sqlite_sequence').run();
    });
  } finally {
    sqlite.prepare('DETACH DATABASE backup').run();
  }
}

export type Db = ReturnType<typeof drizzle>;

export type Connection = { db: Db; sqlite: DatabaseSync };

/** Open the database, set pragmas, apply pending migrations (after a backup) and seed defaults. */
export function openDatabase(options: { migrate?: boolean } = {}): Connection {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });

  const sqlite = new DatabaseSync(file);
  try {
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec('PRAGMA busy_timeout = 5000');

    const db = drizzle({ client: sqlite });
    if (options.migrate !== false) {
      const state = migrationState(sqlite);
      if (state.needsMigration) {
        if (state.hasApplied) backupTo(sqlite, backupsFolder(), '-pre-migrate');
        migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      }
      ensureDefaults(sqlite);
    }
    return { db, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/** Default categories and settings. Safe to call on every start; it only fills gaps. */
export function ensureDefaults(sqlite: DatabaseSync): void {
  const insertCategory = sqlite.prepare(
    `INSERT OR IGNORE INTO categories (name, kind, color, sort_order) VALUES (?, ?, ?, ?)`,
  );
  const insertSetting = sqlite.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  );
  withTransaction(sqlite, () => {
    DEFAULT_CATEGORIES.forEach((c, i) => insertCategory.run(c.name, c.kind, c.color, i));
    for (const s of DEFAULT_SETTINGS) insertSetting.run(s.key, s.value);
  });
}

/** Load .env for the scripts. Next.js does this itself. */
export function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env'));
  } catch {
    // No .env file; DATABASE_PATH falls back to ./data/finance.db.
  }
}
