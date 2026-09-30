import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BackupError,
  TABLES,
  backupTo,
  ensureDefaults,
  openDatabase,
  prepareBackup,
  restoreFrom,
  wipeAll,
  type Connection,
} from '@/lib/db/connect';

/** PLAN section 11, phase 6: backup → reset → restore brings everything back exactly. */

const dir = mkdtempSync(join(tmpdir(), 'hisaab-backup-'));
let conn: Connection;

const snapshot = (sqlite: Database.Database) =>
  Object.fromEntries(
    [...TABLES, 'sqlite_sequence'].map((t) => [
      t,
      sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(),
    ]),
  );

beforeAll(() => {
  const seeded = spawnSync(process.execPath, ['scripts/seed.ts'], {
    env: { ...process.env, DATABASE_PATH: join(dir, 'live.db') },
    encoding: 'utf8',
  });
  if (seeded.status !== 0) throw new Error(`Seed failed: ${seeded.stderr}`);
  process.env.DATABASE_PATH = join(dir, 'live.db');
  conn = openDatabase({ migrate: false });
});

afterAll(() => {
  conn.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('backup and restore', () => {
  it('brings every row back after a reset', () => {
    const { sqlite } = conn;
    const before = snapshot(sqlite);
    expect(before.transactions!.length).toBeGreaterThan(0);

    const file = backupTo(sqlite, join(dir, 'backups'));
    wipeAll(sqlite);
    ensureDefaults(sqlite);
    sqlite
      .prepare(
        `INSERT INTO accounts (name, type, opening_date) VALUES ('Made after the backup', 'cash', '2026-09-01')`,
      )
      .run();
    expect(snapshot(sqlite)).not.toEqual(before);

    const copy = join(dir, 'upload.db');
    copyFileSync(file, copy);
    prepareBackup(copy);
    restoreFrom(sqlite, copy);
    expect(snapshot(sqlite)).toEqual(before);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('turns away a file that is not a database', () => {
    const file = join(dir, 'notes.db');
    writeFileSync(file, 'just some text');
    expect(() => prepareBackup(file)).toThrow(BackupError);
  });

  it('turns away a database without Hisaab tables', () => {
    const file = join(dir, 'other.db');
    const other = new Database(file);
    other.exec('CREATE TABLE things (id INTEGER PRIMARY KEY)');
    other.close();
    expect(() => prepareBackup(file)).toThrow(/isn't a Hisaab backup/);
  });
});
