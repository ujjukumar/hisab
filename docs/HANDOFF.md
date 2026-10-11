# Hisaab CLI handoff

Updated: 7 Oct 2026

## Current task

The user asked for all tables to be sortable like the Investments table in the attached screenshot. Work is implemented locally but **not committed or pushed**. The current branch is `master`, based on `origin/master` at `e592841` (`Improve price history and add theme switch`). The working tree contains only the sorting changes plus this handoff file.

Sorting now covers the data columns on:

- Money transactions: date, description, category, account and amount. Database sorting occurs before the 100-row page limit.
- Investment holdings: name, last price, period change, cost, value, portfolio share and total return. The group, sold visibility and investment period stay in the sort URL.
- Investment performance: name, current value, invested, gain, absolute return and XIRR.
- Investment transactions, including the transactions table on holding detail: date, investment, action, price, units, balance units, amount and linked account. Running balances are computed before sorting and pagination.
- Accounts, budgets, categories, and both report category tables.
- Value Research import preview tables: sortable in place; matching/class select controls themselves are not sortable.

`components/DataTable/DataTable.tsx` supports typed `sortValue`s, URL-backed links, and client-owned `onSort` tables. `components/DataTable/sorting.ts` implements copied-array sorting, natural text ordering, numeric ordering, and nulls-last in both directions. Sort state is exposed through `aria-sort` and a visible active arrow. Money and investment transaction queries parse/preserve sort state.

## Verification already completed

- `npm test`: 26 files, 245 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed using a temporary database.
- Browser check with invented sample data: Investments current-value column toggled descending/ascending, the active `aria-sort` changed accordingly, and the `group=mf` filter remained in the URL. Actual values were verified monotonic for the visible investment rows and Money amount rows.
- `git diff --check`: passed.
- Temporary test server and database were stopped/removed. Do not reuse port 3019 without checking its owner; see Privacy note.

## Important privacy note

A leftover local Next dev process occupied port 3019 during a browser check. It rendered populated local account data instead of the expected invented seed. The process was stopped once identified; do not restart or inspect that database or include any account names, balances, screenshots, or real data in tests, docs, commits, or chat. Use an isolated temporary `DATABASE_PATH` and verify the visible “Sample data” marker before any populated UI check. No local database or `.env` file is staged.

## VM deployment state

The VM is `ujju@myvm`, Ubuntu 26.04, reachable with the user's SSH alias/key. The deployed app is available at `https://myvm.tail276cc3.ts.net` and runs as `hisaab.service` on `127.0.0.1:8787`; Tailscale Serve is tailnet-only and proxies to that localhost port. `tailscaled` and `ac-daemon.service` are active.

The Near voice signaling and TURN services were intentionally removed at the user's explicit request. Their units and `/opt/near` code were removed after making a root-only rollback archive at `/var/backups/hisaab-predeploy-20261006T183103Z/near-voicechat.tar.gz`. `/etc/near` and TURN state were not deleted. Do not alter Tailscale Serve, `tailscaled`, or the AC service.

The VM was deployed before commit `e592841`, so it **does not contain the later theme toggle or the current sorting changes**. If asked to deploy, stage only Git-tracked/unignored source; never copy local `data/`, `*.db*`, or `.env*`. Node 24.21.0 is installed user-locally at `/home/ujju/.local/opt/node24`; system Node 22 remains untouched. Deploy with a source archive, build on VM using `DATABASE_PATH=/home/ujju/hisaab/data/finance.db`, then restart only `hisaab.service`. Verify the existing tailnet URL. The previous install reported one production audit issue (`source-map-js` via Next/PostCSS) and additional dev-only issues; do not run `npm audit fix --force` without approval.

## Next steps

1. Inspect `git diff` and confirm it contains only the documented sorting implementation; do not reset or discard changes.
2. Optionally exercise a few additional tables in the browser using a temporary invented database (especially reports, budgets, and both import preview tables). Avoid inspecting user data.
3. If clean, run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` with a temporary database, and `git diff --check`.
4. The user has not asked to commit or deploy this sorting change yet. Wait for their instruction before committing/pushing or updating the VM.

## Relevant project guidance

- Read [CLAUDE.md](../CLAUDE.md), [README.md](../README.md), and [PLAN.md](PLAN.md) before broad project work.
- Local-only finance app. Bind to `127.0.0.1`; the only runtime network requests are approved whole-market AMFI/NSE/BSE price files in `lib/feeds.ts`.
- Never commit `data/`, databases, environment secrets, or real financial data. Sample data in `scripts/seed.ts` is invented.
- Node.js 24+ is required for built-in SQLite; use the pinned Drizzle `node-sqlite` driver. Existing DBs are backed up before schema/history migrations.
- Typescript strict; amounts in integer paise; dates use helpers in `lib/domain/dates.ts`; only queries/actions access DB; CSS uses tokens.
