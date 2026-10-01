import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, openDatabase, prepareBackup } from '@/lib/db/connect';

const legacyCreatedAt = 1790604645711;
const migrationName = '20260928141045_aberrant_bloodaxe';
const migrationSql = readFileSync(join(MIGRATIONS_FOLDER, migrationName, 'migration.sql'), 'utf8');
const alternateLineEndingHash = createHash('sha256')
  .update(migrationSql.includes('\r\n') ? migrationSql.replaceAll('\r\n', '\n') : migrationSql.replaceAll('\n', '\r\n'))
  .digest('hex');

describe('migration history upgrade', () => {
  it('does not claim an existing SQLite file without migration history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hisaab-untracked-'));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(directory, 'untracked.db');
    try {
      const existing = new DatabaseSync(process.env.DATABASE_PATH);
      existing.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
      existing.close();
      expect(() => openDatabase()).toThrow(/without migration history/);
      const unchanged = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
      try {
        expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get())
          .toBeUndefined();
      } finally {
        unchanged.close();
      }
    } finally {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('backs up an existing 0.x database before upgrading its history, without replaying SQL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hisaab-legacy-'));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(directory, 'legacy.db');
    try {
      const initial = openDatabase();
      initial.sqlite.prepare('INSERT INTO accounts (name, type, opening_date) VALUES (?, ?, ?)')
        .run('Example cash', 'cash', '2026-09-01');
      initial.sqlite.exec(`DROP TABLE __drizzle_migrations;
        CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);`);
      initial.sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(alternateLineEndingHash, legacyCreatedAt);
      initial.sqlite.close();

      const upgraded = openDatabase();
      try {
        expect(upgraded.sqlite.prepare('SELECT name FROM accounts').get()).toEqual({ name: 'Example cash' });
        expect(upgraded.sqlite.prepare('SELECT name FROM __drizzle_migrations').get()).toEqual({
          name: migrationName,
        });
      } finally {
        upgraded.sqlite.close();
      }

      const backups = readdirSync(join(directory, 'backups'));
      expect(backups).toHaveLength(1);
      expect(backups[0]).toContain('-pre-migrate');
      const original = new DatabaseSync(join(directory, 'backups', backups[0]!), { readOnly: true });
      try {
        expect(original.prepare('SELECT name FROM accounts').get()).toEqual({ name: 'Example cash' });
        expect(original.prepare('PRAGMA table_info(__drizzle_migrations)').all())
          .not.toContainEqual(expect.objectContaining({ name: 'name' }));
      } finally {
        original.close();
      }
      const upload = join(directory, 'upload.db');
      copyFileSync(join(directory, 'backups', backups[0]!), upload);
      prepareBackup(upload);
      const prepared = new DatabaseSync(upload, { readOnly: true });
      try {
        expect(prepared.prepare('SELECT name FROM __drizzle_migrations').get())
          .toEqual({ name: migrationName });
      } finally {
        prepared.close();
      }
      const repeated = openDatabase();
      repeated.sqlite.close();
      expect(readdirSync(join(directory, 'backups'))).toEqual(backups);
    } finally {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an unknown legacy history row without changing the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hisaab-unknown-migration-'));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(directory, 'unknown.db');
    try {
      const initial = openDatabase();
      initial.sqlite.prepare('INSERT INTO accounts (name, type, opening_date) VALUES (?, ?, ?)')
        .run('Example cash', 'cash', '2026-09-01');
      initial.sqlite.exec(`DROP TABLE __drizzle_migrations;
        CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);`);
      initial.sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('not-the-original-migration', legacyCreatedAt);
      initial.sqlite.close();

      expect(() => openDatabase()).toThrow(/migration history does not match/);
      const unchanged = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
      try {
        expect(unchanged.prepare('SELECT name FROM accounts').get()).toEqual({ name: 'Example cash' });
        expect(unchanged.prepare('PRAGMA table_info(__drizzle_migrations)').all())
          .not.toContainEqual(expect.objectContaining({ name: 'name' }));
      } finally {
        unchanged.close();
      }
    } finally {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});