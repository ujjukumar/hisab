# Hisaab

A private record of money and investments, for one person, on one machine.

Everything lives in a single SQLite file. There is no account, no login and no
server anywhere else. The app binds to `127.0.0.1`, so nothing else on the
network can reach it.

Amounts are in rupees, grouped the Indian way, with Lakh and Crore where that
reads better.

## Install

Requires Node.js 24 or newer (the scripts use Node's built-in TypeScript
support) and a C toolchain for `better-sqlite3`'s native build.

```bash
npm install
```

Then turn off Next.js telemetry once, globally:

```bash
npx next telemetry disable
```

`NEXT_TELEMETRY_DISABLED=1` is also set in `.env`, so it stays off either way.

## First run

Copy the example environment file and create the database folder:

```bash
cp .env.example .env
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
applies a pending migration (`…-pre-migrate.db`), before a restore
(`…-pre-restore.db`) and before Settings → start fresh (`…-pre-reset.db`).
Nothing deletes old backups; clear the folder out yourself now and then.

**Start fresh.** Settings → Remove sample data and start fresh deletes every
row and puts back the default categories, after a backup. Type `DELETE` to
confirm. `npm run reset -- --yes` does the same from a terminal, without the
backup.

**Export.** Settings → Export everything downloads a zip with one CSV per table.
Amounts are in paise (divide by 100 for rupees). It is for your own analysis;
use a backup, not the export, to move your data to another computer. Reports
has its own Export CSV for the year on screen.

## Privacy

- The server always binds to `127.0.0.1`, never `0.0.0.0`.
- Next.js telemetry is disabled.
- Fonts are downloaded at build time and served from this machine. The running
  app makes no external requests at all.
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
