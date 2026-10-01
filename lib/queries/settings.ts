import 'server-only';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '@/lib/db/client';
import { TABLES, backupTo, backupsFolder, databasePath } from '@/lib/db/connect';
import { settings } from '@/lib/db/schema';
import { cell } from '@/lib/csv';
import { COMPOUNDING } from '@/lib/domain/assets';
import { isValidDate, type IsoDate } from '@/lib/domain/dates';
import { formatDay, formatTime } from '@/lib/domain/format';

/** Read one setting. Returns null when it has never been written. */
export async function getSetting(key: string): Promise<string | null> {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** Whether the database currently holds the invented sample data. */
export async function isSampleData(): Promise<boolean> {
  return (await getSetting('sample_data')) === 'true';
}

/** The month the financial year starts in. April unless changed in settings. */
export async function financialYearStartMonth(): Promise<number> {
  const value = Number(await getSetting('financial_year_start_month'));
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : 4;
}

/** The interest compounding new fixed deposits start with. Quarterly unless changed in settings. */
export async function defaultCompounding(): Promise<(typeof COMPOUNDING)[number]> {
  const value = parseJson(await getSetting('default_fd_compounding'));
  return COMPOUNDING.find((c) => c === value) ?? 'quarterly';
}

function parseJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** Where the data lives and how big it is, for Settings › About. */
export function databaseInfo(): {
  path: string;
  bytes: number;
  backups: string;
  backupCount: number;
} {
  const path = databasePath();
  // The WAL file holds recent writes until the next checkpoint, so it counts too.
  const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
  const backups = backupsFolder();
  const backupCount = existsSync(backups)
    ? readdirSync(backups).filter((f) => f.endsWith('.db')).length
    : 0;
  return { path, bytes: size(path) + size(`${path}-wal`), backups, backupCount };
}

/** Save a copy to data/backups and return its path. */
export function makeBackup(): string {
  return backupTo(sqlite);
}

/**
 * Every table as a raw CSV file for the full export: stored values as they are, so
 * amounts are paise and settings are JSON. Text is quoted by `cell`.
 */
export function exportTables(): { name: string; text: string }[] {
  return TABLES.map((table) => {
    const stmt = sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`);
    const header = stmt.columns().map((c) => c.name);
    const lines = (stmt.all() as Record<string, unknown>[]).map((row) =>
      header
        .map((c) => {
          const v = row[c];
          return typeof v === 'string' ? cell(v) : v == null ? '' : String(v);
        })
        .join(','),
    );
    return { name: `${table}.csv`, text: [header.join(','), ...lines].join('\r\n') + '\r\n' };
  });
}

/** Whether prices are downloaded when the app opens. On unless switched off in Settings. */
export async function autoPrices(): Promise<boolean> {
  return (await getSetting('auto_prices')) !== 'false';
}

/** The last automatic or requested price update, saved as JSON in `price_update`. */
export type PriceUpdate = {
  /** The day it ran, for the once-a-day check. */
  on: IsoDate;
  /** When it finished, as an ISO timestamp. */
  at: string;
  ok: boolean;
  updated: number;
  message: string;
};

export async function priceUpdate(): Promise<PriceUpdate | null> {
  const value = parseJson(await getSetting('price_update'));
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<PriceUpdate>;
  return typeof v.on === 'string' && isValidDate(v.on) && typeof v.at === 'string'
    ? {
        on: v.on,
        at: v.at,
        ok: v.ok === true,
        updated: typeof v.updated === 'number' ? v.updated : 0,
        message: typeof v.message === 'string' ? v.message : '',
      }
    : null;
}

/** 'Prices updated 1 Oct, 7:40 pm.', followed by anything that went wrong. */
export function priceStatus(last: PriceUpdate): string {
  const done = last.ok || last.updated > 0;
  return [done && `Prices updated ${formatDay(last.on)}, ${formatTime(last.at)}.`, last.message]
    .filter(Boolean)
    .join(' ');
}
