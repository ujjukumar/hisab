import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/connect';
import { prices } from '@/lib/db/schema';
import type { IsoDate } from '@/lib/domain/dates';

/**
 * Save downloaded prices in one transaction (PLAN section 11, phase 8). A price the owner typed
 * in or imported for the same day is never replaced; an earlier automatic one is.
 * Kept apart from the 'use server' file so tests can call it with their own database.
 */
export function applyFeedPrices(
  db: Db,
  rows: { assetId: number; date: IsoDate; price: string }[],
): number {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    let saved = 0;
    for (const row of rows) {
      saved += tx
        .insert(prices)
        .values({ ...row, source: 'auto' })
        .onConflictDoUpdate({
          target: [prices.assetId, prices.date],
          set: { price: sql`excluded.price`, updatedAt: now },
          setWhere: eq(prices.source, 'auto'),
        })
        .run().changes as number;
    }
    return saved;
  });
}
