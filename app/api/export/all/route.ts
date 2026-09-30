import { today } from '@/lib/domain/dates';
import { exportTables } from '@/lib/queries/settings';
import { zip } from '@/lib/zip';

const README = `Hisaab full export

One CSV file per table, with the values exactly as stored:
- Amounts are in paise (divide by 100 for rupees). Units, prices and rates are decimals.
- Dates are YYYY-MM-DD. Ids link the files together, e.g. transactions.account_id = accounts.id.
- Settings values are JSON.

To move your data to another copy of Hisaab, use a backup (.db) instead: Settings > Restore from backup.
`;

/** Export everything as CSV: every table in one zip. */
export function GET() {
  const date = today();
  const archive = zip([{ name: 'README.txt', text: README }, ...exportTables()]);
  return new Response(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="hisaab-export-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
