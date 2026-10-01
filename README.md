# Hisaab

A private record of money and investments, for one person, on one machine.

Everything lives in a single SQLite file. There is no account, no login and no
server anywhere else. The app binds to `127.0.0.1`, so nothing else on the
network can reach it.

Amounts are in rupees, grouped the Indian way, with Lakh and Crore where that
reads better.

## Install

Requires Node.js 24 or newer. The scripts use Node's built-in TypeScript and
SQLite support; no separate SQLite addon or C++ compiler is needed. Drizzle ORM
and Kit are pinned to matching 1.0 release candidates for the Node SQLite driver.

```bash
npm install
```

Then turn off Next.js telemetry once, globally:

```bash
npx next telemetry disable
```

`NEXT_TELEMETRY_DISABLED=1` is also set in `.env`, so it stays off either way.

## First run

Copy the example environment file (PowerShell):

```powershell
Copy-Item .env.example .env
```

`.env` holds one setting that matters:

```
DATABASE_PATH=./data/finance.db
```

The folder is created automatically on first connect, and the schema is applied
from the migrations in `lib/db/migrations`.

To look around with invented sample data first:

```bash
npm run seed
```

Then start the app:

```bash
npm run dev
```

Open <http://127.0.0.1:3000>.

When you are ready to use it for real, empty it:

```bash
npm run reset -- --yes
```

That deletes every row and recreates the default categories. The `--yes` is
required; without it the script refuses.

## Daily use

`npm run dev` rebuilds on every request, which is slower than it needs to be for
everyday use. Build once and run the production server instead:

The build applies migrations in one process before Next starts its parallel workers.
An existing database is backed up first if migration SQL or history must change.

```bash
npm run build
```

```bash
npm start
```

Both serve on <http://127.0.0.1:3000>. Rebuild after pulling changes.

## Backup and restore

Everything is in one file, so a backup is one file too. Keep a recent one
somewhere other than this computer, such as a USB drive.

**Back up.** In the app, go to Settings → Back up now. That saves a copy to
`data/backups/finance-YYYYMMDD-HHmm.db` and downloads the same file. From a
terminal, this does the same without the download:

```bash
npm run backup
```

Both write a consistent copy (`VACUUM INTO`), so they are safe while the app is
open. The result is a plain SQLite file you can copy anywhere.
When moving to another computer, copy this backup rather than the live database
file while the app is running; recent changes may still be in its WAL file.

**Restore.** In the app, go to Settings → Restore from backup and choose a `.db`
file. The app checks it first (it must be a Hisaab backup, undamaged, and not
from a newer version) and changes nothing if it isn't. It then saves your
current data as `…-pre-restore.db` and replaces everything with the backup's.
Backups from an older version are brought up to date as they are restored.

If the app won't start, restore by hand instead: stop it, delete
`data/finance.db-wal` and `data/finance.db-shm` if they exist, and copy the
backup over the live file:

```bash
cp data/backups/finance-20260928-2130.db data/finance.db
```

**Automatic backups.** The app also saves a backup in the same folder before it
applies a pending migration or upgrades migration history (`…-pre-migrate.db`), before a restore
(`…-pre-restore.db`), before an import (`…-pre-import.db`) and before Settings →
start fresh (`…-pre-reset.db`).
Nothing deletes old backups; clear the folder out yourself now and then.

**Start fresh.** Settings → Remove sample data and start fresh deletes every
row and puts back the default categories, after a backup. Type `DELETE` to
confirm. `npm run reset -- --yes` does the same from a terminal, without the
backup.

**Export.** Settings → Export everything downloads a zip with one CSV per table.
Amounts are in paise (divide by 100 for rupees). It is for your own analysis;
use a backup, not the export, to move your data to another computer. Reports
has its own Export CSV for the year on screen.

## Importing from Value Research

Investments → Import (or Settings → Import from Value Research) reads the
Transaction History that Value Research downloads as Excel (`.xls`). Choose
All-time as the period.

1. Choose the file and select **Check file**. Nothing changes yet. You see how
   many transactions will be added, which rows can't be imported and why, and
   each fund or stock in the file.
2. For each new one, pick **New investment** or an investment you already
   entered by hand, and check the asset class.
3. Optionally choose an account under **Record in Money** to add each buy and
   sale as a transfer from or to it.
4. Select **Import**.

Funds and stocks are matched by ISIN, and transactions already in Hisaab are
skipped, so you can import a fresh All-time file whenever you like and only
the new rows are added. A backup is saved first as `…-pre-import.db`; restore
it from Settings to undo an import.

## Automatic prices

Once a day, the first time you open the app, Hisaab downloads the latest fund
NAVs from AMFI and the last closing prices of stocks and ETFs from NSE. This
works for funds, stocks and ETFs whose **Symbol or code** is their ISIN (the
Value Research import fills it in). Investments shows when prices were last
updated, with **Update now** to fetch them again.

- Only AMFI's and NSE's public whole-market files are downloaded, about 0.5 MB
  a day. Nothing about your investments is sent.
- Each price is saved under the date in the file, so you keep one price per
  day for the days you open the app. Prices you enter or import are never
  replaced.
- **Settings → Prices → Fetch past prices** fills missing weekday prices for
  the last 30 days and weekly prices before that, back to your first purchase.
  Older weeks end on Sunday and look back up to seven days for a trading price;
  the estimated maximum download size appears before you start. You can stop it
  and carry on later.
- Turn off automatic prices under **Settings → Prices** to stop downloads on
  open. A manual update or past-price fetch downloads only when you request it.

## Privacy

- The server always binds to `127.0.0.1`, never `0.0.0.0`.
- Next.js telemetry is disabled.
- Fonts are downloaded at build time and served from this machine. The running
  app's only requests are the AMFI and NSE price files above, which you can
  switch off.
- `data/` is never committed. Neither are `*.db`, `*.db-wal`, `*.db-shm` or
  `.env*`.
- Every name and number in `scripts/seed.ts` is invented. No real financial data
  belongs anywhere in this repository.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server on 127.0.0.1:3000 |
| `npm run build` / `npm start` | Production build, then serve it |
| `npm run db:generate` | Generate a migration after changing the schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run seed` | Load invented sample data into an empty database |
| `npm run reset -- --yes` | Wipe all data, recreate default categories |
| `npm run backup` | Write a timestamped backup |
| `npm test` / `npm run test:watch` | Run the unit tests |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

`/dev/ui` shows every shared component with sample props, in light and dark side
by side. It is not served in a production build.

## Where things are

```
app/             routes, layout, fonts
components/      shared UI, one folder per component with its CSS Module
lib/db/          schema, migrations, connection
lib/domain/      money, dates, formatting — pure functions, all tested
lib/queries/     the only place that reads the database
scripts/         seed, reset, backup, migrate
styles/          tokens.css and globals.css
docs/PLAN.md     the full brief
```
