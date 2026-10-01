import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { withTransaction } from '@/lib/db/transaction';

describe('raw SQLite transactions', () => {
  it('rolls back a failed nested call without losing the outer transaction', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec('CREATE TABLE entries (value TEXT NOT NULL)');
      withTransaction(sqlite, () => {
        sqlite.prepare('INSERT INTO entries VALUES (?)').run('before');
        expect(() => withTransaction(sqlite, () => {
          sqlite.prepare('INSERT INTO entries VALUES (?)').run('discard');
          throw new Error('failed');
        })).toThrow('failed');
        sqlite.prepare('INSERT INTO entries VALUES (?)').run('after');
      });
      expect(sqlite.prepare('SELECT value FROM entries').all()).toEqual([
        { value: 'before' },
        { value: 'after' },
      ]);
      expect(sqlite.isTransaction).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the outer transaction on failure', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec('CREATE TABLE entries (value TEXT NOT NULL)');
      expect(() => withTransaction(sqlite, () => {
        sqlite.prepare('INSERT INTO entries VALUES (?)').run('discard');
        throw new Error('failed');
      })).toThrow('failed');
      expect(sqlite.prepare('SELECT value FROM entries').all()).toEqual([]);
      expect(sqlite.isTransaction).toBe(false);
    } finally {
      sqlite.close();
    }
  });
});