import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
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
      initial.sqlite.exec('ALTER TABLE assets DROP COLUMN nav_start_date');
      initial.sqlite.exec(
        'DROP TABLE sms_pairing_invites; DROP TABLE sms_messages; DROP TABLE sms_rules; DROP TABLE sms_devices;',
      );
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

  it('keeps paired phones and their messages when the QR pairing migration rebuilds sms_devices', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hisaab-sms-invites-'));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(directory, 'paired.db');
    try {
      const older = join(directory, 'migrations');
      cpSync(MIGRATIONS_FOLDER, older, {
        recursive: true,
        filter: (source) => !source.includes('sms_pairing_invites'),
      });
      const initial = new DatabaseSync(process.env.DATABASE_PATH);
      migrate(drizzle({ client: initial }), { migrationsFolder: older });
      initial.exec(`
        INSERT INTO sms_devices (label, token_hash, claim_hash, code, approved_at, claimed_at)
          VALUES ('Invented phone', 'token-hash-1', 'claim-hash-1', 'ABC234',
            '2026-10-07T08:00:00.000Z', '2026-10-07T08:00:00.000Z');
        INSERT INTO sms_devices (label, claim_hash, code)
          VALUES ('Invented waiting phone', 'claim-hash-2', 'XYZ789');
        INSERT INTO sms_messages (device_id, sender, received_at, content_hash, parser_version, status)
          VALUES (1, 'DEMO-ALERT', '2026-10-07T08:00:00+05:30', 'content-hash-1', '1', 'pending');
      `);
      const before = {
        devices: initial.prepare('SELECT * FROM sms_devices ORDER BY id').all(),
        messages: initial.prepare('SELECT * FROM sms_messages ORDER BY id').all(),
      };
      initial.close();

      const upgraded = openDatabase();
      try {
        const rows = (table: string) =>
          upgraded.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
        expect(rows('sms_devices')).toEqual(before.devices);
        expect(rows('sms_messages')).toEqual(before.messages);
        expect(upgraded.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        const keys = upgraded.sqlite.prepare('PRAGMA foreign_key_list(sms_messages)').all();
        expect(keys).toContainEqual(
          expect.objectContaining({ from: 'device_id', table: 'sms_devices' }),
        );
        // QR-paired phones have no claim hash or code.
        upgraded.sqlite.exec(`
          INSERT INTO sms_devices (label, token_hash, approved_at, claimed_at)
            VALUES ('Invented QR phone', 'token-hash-3',
              '2026-10-11T08:00:00.000Z', '2026-10-11T08:00:00.000Z');
        `);
      } finally {
        upgraded.sqlite.close();
      }
    } finally {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});