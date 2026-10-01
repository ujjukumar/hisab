import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/lib/db/connect';
import { settings } from '@/lib/db/schema';

const jobSchema = z.object({
  id: z.string(),
  state: z.enum(['running', 'stopping', 'stopped', 'done', 'failed']),
  attempted: z.array(z.string()),
  done: z.number(),
  total: z.number(),
  date: z.string().nullable(),
  updated: z.number(),
  message: z.string(),
  owner: z.string().nullable(),
  pid: z.number().nullable(),
  heartbeat: z.string(),
});

export type PriceJob = z.infer<typeof jobSchema>;
export type PriceJobStatus = Pick<
  PriceJob,
  'state' | 'done' | 'total' | 'date' | 'updated' | 'message'
>;

type StoreDb = Pick<Db, 'select' | 'insert'>;

export function readPriceJob(database: StoreDb): PriceJob | null {
  const row = database
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'price_job'))
    .get();
  if (!row) return null;
  try {
    return jobSchema.safeParse(JSON.parse(row.value ?? '')).data ?? null;
  } catch {
    return null;
  }
}

export function writePriceJob(database: StoreDb, job: PriceJob): void {
  database
    .insert(settings)
    .values({ key: 'price_job', value: JSON.stringify(job) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(job), updatedAt: new Date().toISOString() },
    })
    .run();
}

export function claimPriceJob(
  database: Db,
  owner: string,
  pid: number,
  now: string,
  isAlive: (pid: number) => boolean,
): PriceJob | null {
  return database.transaction((tx) => {
    const job = readPriceJob(tx);
    if (!job || (job.state !== 'running' && job.state !== 'stopping')) return null;
    const otherIsActive =
      job.owner !== null &&
      job.owner !== owner &&
      job.pid !== null &&
      isAlive(job.pid) &&
      Date.parse(now) - Date.parse(job.heartbeat) < 120_000;
    if (otherIsActive) return null;
    if (job.state === 'stopping') {
      writePriceJob(tx, { ...job, state: 'stopped', owner: null, pid: null });
      return null;
    }
    const claimed = { ...job, owner, pid, heartbeat: now };
    writePriceJob(tx, claimed);
    return claimed;
  });
}
