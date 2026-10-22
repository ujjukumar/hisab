# Hisaab

A personal finance app for one owner in India. Everything lives in one SQLite
file. Read [docs/PLAN.md](docs/PLAN.md) before starting a
phase; it holds the product and calculation rules. Keep its section 15 Progress
log current with a short outcome, not a transcript of implementation steps.

## Where the app runs

Development now happens directly on `ujju@myvm`, in `/home/ujju/hisaab`, which is
also the live install. [docs/HANDOFF.md](docs/HANDOFF.md) has the details.

- Node 24 lives in `/home/ujju/.local/opt/node24/bin`; put it first on `PATH`
  (`export PATH=/home/ujju/.local/opt/node24/bin:$PATH`). System Node is older.
- The live app is `hisaab.service` on `127.0.0.1:8787`, served on the tailnet at
  `https://myvm.tail276cc3.ts.net`. Its database is `data/finance.db` and holds the
  owner's real data: never open, query, quote or copy it. For UI checks, run
  `npx next dev -p 3123` with `DATABASE_PATH` pointing at a temporary copy of the
  invented seed (the Sample data pill shows).
- To ship: run the checks, commit, `git push origin master`, then
  `DATABASE_PATH=/home/ujju/hisaab/data/finance.db npm run build` (it backs up and
  migrates), `sudo systemctl restart hisaab.service` and check the URL. Keep
  `.next/cache` between builds.
- Commit in small steps with plain messages; GitHub (`origin`, branch `master`) is
  the backup.

## Setup and checks

Use [README.md](README.md#commands) for setup and commands. Code changes must pass
`npm run lint`, `npm run typecheck` and `npm test`, plus the relevant manual checks
in the plan. Summarise results and any deviations before starting another phase.

Scripts under `scripts/` are plain `.ts` run by Node's own type stripping, so
relative imports inside them need explicit `.ts` extensions.

## Privacy and local-only defaults

- Always bind to `127.0.0.1`, never `0.0.0.0`, so other devices on the network can't reach the app.
- Next.js telemetry is off: `NEXT_TELEMETRY_DISABLED=1` in `.env`, plus `npx next telemetry disable`.
- `.gitignore` covers `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `.env*`.
- The only network use is `npm install`, the build-time font download and, while the app runs, AMFI's NAV files and NSE's and BSE's bhavcopy for automatic prices, plus mfapi.in for a benchmark fund's NAV history (`lib/feeds.ts`, the only file that may go online). The market files are whole-market: nothing about the owner's holdings is sent. mfapi.in only learns which benchmark fund is being compared. The owner can switch feeds off in Settings. Add no other external request.
- The database path comes from `DATABASE_PATH` (default `./data/finance.db`). Create the folder if it's missing.
- Node.js 24+ supplies SQLite through `node:sqlite`; use Drizzle's `node-sqlite` driver. Drizzle ORM and Kit are pinned to matching 1.0 RC versions. Back up an existing database before upgrading legacy migration history, even when no schema SQL is pending.
- **Never commit anything in `data/`. Never use real personal financial data anywhere in the repo** — not in seed files, fixtures, tests, screenshots or commit messages. All sample data is invented.
- Do not copy any third-party logo, name, image or asset.

## Conventions

- TypeScript strict. No `any`, no `@ts-ignore` without a comment explaining why.
- Money is integer paise in all code. Use the `Paise` type alias and convert only at input parsing and display. Units, prices and rates are decimal strings and are calculated with `decimal.js`.
- Dates are `YYYY-MM-DD` strings, months are `YYYY-MM`. Use the helpers in `lib/domain/dates.ts`; never create a `Date` for date-only values without them (avoids timezone shifts).
- Only `lib/queries` and `lib/actions` touch the database. Components never import `lib/db`.
- Every server action validates with Zod, runs writes in a transaction, revalidates affected paths and returns the standard result shape.
- Components live in their own folder with a CSS Module. Use CSS variables from `styles/tokens.css` only; no raw hex colours in components.
- Every function in `lib/domain` has unit tests, including edge cases (zero units, sell everything, split, missing prices, leap years).
- Add a dependency only when it clearly earns its place, and mention why in the phase summary. Approved: next, react, react-dom, typescript, drizzle-orm, drizzle-kit, zod, decimal.js, vitest, eslint, prettier, server-only, a zip library for the full export, and uqr for the SMS pairing QR code.

## Copy and design rules

- Green and red are only for gains/losses and over-budget warnings. Spending amounts use the normal text colour with a minus sign (−, U+2212), not red. Transfers are grey.
- Tables show plain numbers without ₹ and a footnote "All amounts in ₹." Cards and strips show ₹.
- Sentence case, plain words, active verbs. A button says what it does ("Save transaction"); the toast uses the same words ("Transaction saved"). Errors say what's wrong and how to fix it, without apologising ("Enter an amount greater than zero."). Empty states invite an action.
- Accessibility: visible keyboard focus, tabs use `role="tab"` with `aria-selected`, sortable headers use `aria-sort`, menus are keyboard reachable, drawers trap focus and return focus on close, `prefers-reduced-motion` disables transitions, colour is never the only signal.
- Responsive down to ~360px. Grids collapse to one column, the nav wraps to a scrollable second row, tables scroll horizontally inside their card.
