import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';

/** Read one setting. Returns null when it has never been written. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
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
