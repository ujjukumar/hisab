import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { makeBackup } from '@/lib/queries/settings';

/** Back up now: save a copy to data/backups and download the same file. POST, since it writes a file. */
export function POST() {
  const file = makeBackup();
  return new Response(readFileSync(file), {
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="${basename(file)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
