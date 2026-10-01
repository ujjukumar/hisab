import type { DatabaseSync } from 'node:sqlite';

export function withTransaction<T>(sqlite: DatabaseSync, work: () => T): T {
  const nested = sqlite.isTransaction;
  sqlite.exec(nested ? 'SAVEPOINT hisaab_nested' : 'BEGIN');
  try {
    const result = work();
    sqlite.exec(nested ? 'RELEASE SAVEPOINT hisaab_nested' : 'COMMIT');
    return result;
  } catch (error) {
    if (sqlite.isTransaction) {
      if (nested) sqlite.exec('ROLLBACK TO SAVEPOINT hisaab_nested; RELEASE SAVEPOINT hisaab_nested');
      else sqlite.exec('ROLLBACK');
    }
    throw error;
  }
}