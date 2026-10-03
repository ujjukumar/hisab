# Hisaab: product and calculation reference

The initial build is complete. This document keeps the durable requirements,
settled decisions and backlog, not the original scaffolding checklist. Section
numbers remain stable because code and tests refer to them.

## 0. Start here

- Use [README.md](../README.md) for setup, operation and commands, and
  [CLAUDE.md](../CLAUDE.md) for coding, privacy and design rules.
- Read this reference before starting a phase. Work one phase at a time, verify
  the relevant behavior, then summarise results before starting another.
- Explain and get agreement before changing the settled decisions in section 13.
- Keep section 15 concise. Git history holds detailed implementation history;
  update the owning section when behavior changes instead of appending a second spec.

## 1. Project summary

**What:** a personal finance web app that runs only on the owner's computer at `http://127.0.0.1:3000`, storing everything in one SQLite file.

**Who:** a single user based in India. Currency is ₹ (INR) only. Numbers use Indian grouping (1,08,289) and Lakh/Crore abbreviations in headline figures.

**Two areas:**

- **Money:** income, spending, transfers between own accounts, account balances, monthly budgets per category.
- **Investments:** holdings, cost, current value, gains, annualised returns (XIRR), allocation. Instruments the owner uses or may use: mutual funds, stocks, ETFs, gold (ETFs and gold bonds), fixed deposits, PPF, EPF, NPS, bonds.

**Not in version 1:** logins or multiple users, cloud sync, bank or broker connections, tax reports, multiple currencies, a mobile app. (See the backlog in section 14.)

---

## 2. Design

### 2.1 Source of truth

[docs/mockup.html](mockup.html) is the approved visual and interaction reference,
using invented data. Preserve its visual language; do not copy third-party logos,
names, images or assets. Reuse existing components for screens it does not cover.

The implemented tokens are in [styles/tokens.css](../styles/tokens.css), base styles
in [styles/globals.css](../styles/globals.css), and fonts in [app/fonts.ts](../app/fonts.ts).
Do not duplicate their values here. The interface uses IBM Plex Sans, IBM Plex Mono
for figures and Fraunces for titles; dark mode follows the system setting.
The development-only `/dev/ui` route shows shared components with invented props.

Copy, color meanings, accessibility and 360px layout requirements live in
[CLAUDE.md](../CLAUDE.md#copy-and-design-rules).

## 3. Architecture

Exact versions and scripts live in [package.json](../package.json). Use Next.js
App Router, React, strict TypeScript, Zod, decimal.js, Vitest, ESLint and Prettier.
Node.js 24+ supplies `node:sqlite`; Drizzle ORM and Kit use matching pinned 1.0 RC
versions and the `node-sqlite` driver. No Tailwind, UI kit or chart library: use
CSS Modules and the existing SVG charts. Fonts download at build time and are
served locally. XLS and ZIP support use the existing local implementations.

- Server Components read through `lib/queries`; there is no separate REST API.
- Server Actions in `lib/actions` validate with Zod, write in a transaction,
  revalidate affected paths and return
  `{ ok: true, id? } | { ok: false, message, fieldErrors }`.
- Client components handle interactions. Route handlers serve file downloads.
- `lib/db` is server-only. Share one connection, cached on `globalThis` during
  development, with WAL and foreign keys enabled.
- Back up existing databases before pending migrations or legacy-history upgrades.
  Builds migrate serially before Next's parallel workers. Accept LF/CRLF variants
  of known migration hashes, but reject unknown history.

## 4. Source map

| Location | Owns |
|---|---|
| `app/` | Routes, layouts and page composition |
| `components/` | Shared controls, drawers, tables and charts |
| `lib/db/` | Schema, migrations and connection |
| `lib/domain/` | Pure calculations and parsers |
| `lib/queries/`, `lib/actions/` | Application database reads and writes |
| `lib/validation/` | Shared Zod schemas |
| `lib/feeds.ts` | The only runtime network requests |
| `scripts/` | Seed, reset, backup and migration tools |
| `tests/` | Unit/integration tests and invented fixtures |
| `data/` | Local database and backups; never committed |

## 5. Data contracts

[lib/db/schema.ts](../lib/db/schema.ts) defines the tables, columns, enums,
constraints and indexes. [lib/domain/assets.ts](../lib/domain/assets.ts) defines
asset groups and defaults. Do not maintain parallel copies of these definitions.

- Money is integer paise; units, prices and percentage rates are decimal strings
  calculated with decimal.js. Dates are `YYYY-MM-DD`, months `YYYY-MM`, timestamps
  ISO 8601. Use the date helpers, not timezone-dependent date parsing.
- Money amounts are positive; transaction type determines direction. Income and
  expense need an account and matching category. Transfers have no category and
  different source/destination accounts. A missing side is allowed only for a
  linked investment transaction, where it means "Investments".
- Budgets apply to spending categories. The latest `start_month <= month` carries
  forward; zero disables the budget from that month. Copying last month's budgets
  replaces this month's overrides. A value equal to the carried amount needs no row.
- Accounts and categories with transactions are archived, not deleted. Investments
  can be archived once sold. Mask account references in the UI.
- Prices and valuations have one row per asset/date. Downloaded prices have
  `source = 'auto'`; downloads must never overwrite `manual` or `import` prices.
- Settings are JSON values keyed by name. Default financial year starts in April,
  default FD compounding is quarterly, and `sample_data` controls the sample pill.

### Linked money transactions

Picking "Paid from" or "Received in" creates a Money row in the same transaction:

- Buy/deposit/fee: transfer from the account to Investments, amount plus fees.
- Sell/withdrawal: transfer from Investments to the account, amount minus fees.
- Dividend/interest: income in the matching Dividends/Interest category.

The Money row stores `investment_txn_id`. Edit through the investment transaction;
updates keep both rows in sync. Deleting either removes both, with Undo available.

## 6. Calculations (`lib/domain`, all pure and unit-tested)

### Formatting (`format.ts`)

- `formatINR(paise)` → `₹1,63,640` (Intl `en-IN`, no decimals). In forms and price cells, show 2 decimals.
- `formatShortINR(paise)`:
  - ≥ 1 Crore → `₹1.25 Cr`
  - ≥ 1 Lakh → `₹21.71 Lakh`
  - otherwise → the full amount.
- Signed values use `+` and `−` (U+2212). Zero has no sign.
- Percentages have 2 decimals, and "p.a." returns have 1 decimal. Values that round to zero show as `0.00%`, never `−0.00%`.
- Dates: `27 Sep 2026` in tables, `27 Sep` in compact lists.
- Chart axes: `0`, `75K`, `1.5L`, `2 Cr`. Tick steps are nice numbers (1, 2, 2.5, 5 × 10ⁿ).

### Money (`balances.ts`, `budgets.ts`)

**Account balance on date D:** opening balance + income into it − spending from it − transfers out + transfers in, for all transactions from the opening date up to D.

**Month summary:**

- Income = sum of income.
- Spending = sum of spending.
- Saved = income − spending.
- Savings rate = saved ÷ income.
- Transfers are excluded from all of these.

**Budgets:**

- Spent = spending in that category this month.
- Left = budget − spent.
- A category is over budget when spent > budget.
- The budget card's total only counts categories that have a budget.

**Net worth:** sum of all non-archived account balances (card balances are negative) + current portfolio value.

### Holdings (`holdings.ts`)

Process each asset's transactions in date order (then by id):

- **Buy:** units += u; cost += u × price + fees.
- **Sell:**
  - Average cost = cost ÷ units; cost removed = average cost × u.
  - Realised gain += (u × price − fees) − cost removed.
  - units −= u; cost −= cost removed.
  - Reject a sale of more units than held on that date, with the error "You only hold X units on that date."
- **Split:** units × (split_to ÷ split_from). Cost is unchanged.
- **Deposit / withdrawal** (manual and fd assets): invested += / −= amount.
- **Dividend / interest:** income received += amount. This does not change cost.
- **Fee:** cost += amount.

Holdings with zero units, or zero invested for manual assets, count as sold. They are hidden unless "Show sold investments" is on.

Test vector:

- Buy 100 units @ 50 with fee 20, then buy 50 @ 62 with fee 10, then sell 60 @ 70 with fee 15.
- Expected: 90 units left, cost 4,878.00, realised gain 933.00.

### Current value (`valuation.ts`)

- **`units`:** units × latest price on or before the date. If no price has been entered, use the last buy price and flag the holding "Price not updated".
- **`manual`:** latest valuation on or before the date, plus later deposits minus later withdrawals. If there is none, use the net amount invested. A withdrawal beyond remaining cost counts as realised gain.
- **`fd`:**
  - Formula: principal × (1 + r/n)^(n × t), where t is in years (days ÷ 365) from start to min(date, maturity). `simple` compounding means principal × (1 + r × t).
  - Test: ₹1,00,000 at 7.10% compounded quarterly for 1 year → ₹1,07,291.28.

### Returns

- **Total return** (holdings table) = current value − cost. This is the unrealised gain.
- **All-time returns** (Investments strip) = (current value + all sale and withdrawal proceeds + dividends and interest received) − (all buy and deposit amounts + fees). This equals unrealised + realised gains + income.
- **Change in period:** choose 1 day, 1 week, 1/3/6 months, financial year to date, 1/3 years or all time.
  - For each holding, gain = value at the end + money taken out − value at the start − money put in during the period.
  - Percent = gain ÷ (starting value + money put in); show "—" when there is no starting value or money put in.
  - The portfolio and group figures combine the selected holdings' gains and cash flows. For 1 day, compare each holding's last two available prices or statements, even when today's price has not arrived; money added or taken out in between is not a gain. With fewer than two prices, fall back to yesterday. Longer periods use calendar dates.
  - Dashboard 1-day net-worth change keeps bank and cash changes from yesterday, adds the latest investment price gain, and excludes investment purchases already funded by cash.

### XIRR (`xirr.ts`)

**Cash flows:**

- Negative: buys and deposits (including fees), fees.
- Positive: sells and withdrawals (after fees), dividends and interest.
- Final positive flow: current value, dated today (or the "as of" date).

**Method:** annual rate with a 365-day year. Newton–Raphson starting at 0.1 (tolerance 1e-7, max 100 iterations). If it fails to converge, fall back to bisection on [−0.9999, 100]. Return `null` when there is no sign change in the flows.

**Holdings younger than 365 days:** show the absolute return with the suffix "abs." instead of "p.a.", because annualising short periods produces misleading numbers.

**Test vectors:**

- Flows: −10,000 on 2008-01-01, +2,750 on 2008-03-01, +4,250 on 2008-10-30, +3,250 on 2009-02-15, +2,750 on 2009-04-01. Expected ≈ 0.3733625 (tolerance 1e-6).
- Flows: −10,000 on 2023-01-01, +11,000 on 2024-01-01. Expected 0.10.

**Aggregates:** per-group and portfolio XIRR combine the cash flows of all included holdings.

### Performance series (`performance.ts`)

For a selected range of up to 45 days, plot available price, statement and transaction dates;
for up to a year, plot weekly checkpoints; for longer ranges and all time, plot month-ends.
Include the range start and last day, and position points according to calendar time:

- **Invested** = total cost of holdings on that date (same rules as above).
- **Worth** = value of holdings on that date, using the latest price or valuation known on or before it.

Periods include 1 day, 1 week, 1/3/6 months, financial year to date, 1/3 years and all time. YTD follows the configured financial year; the Dashboard's portfolio YTD chip uses the calendar year.

### Allocation

- **By asset:** sums of value by `asset_class`.
- **By investment type:** sums of value by display group.

### Top gainers and losers

The top 3 holdings each way over a chosen period (1 day, 1 week, 1/3/6 months, financial year to date, 1/3 years, all time), as a value or percent. Filters: period, investment group, and sort by value or %.

---

## 7. Screens and interaction

| Route | Purpose |
|---|---|
| `/` | Month-based dashboard, cash flow, portfolio, budgets, recent activity and accounts |
| `/money` | Transactions with date/type/category/account/search filters, totals and CSV |
| `/money/budgets` | Monthly budgets, inline editing, carry-forward and copy previous month |
| `/money/accounts`, `/money/categories` | Create, edit and archive accounts/categories |
| `/investments` | Grouped holdings, sold toggle, price fetches and statement updates |
| `/investments/performance` | As-of date and period, flow-adjusted returns, chart, tables and CSV |
| `/investments/transactions` | Filtered investment activity, running units and CSV |
| `/investments/[assetId]` | Holding summary, period chart, transactions and FD details |
| `/investments/import` | Check and import Value Research transaction history |
| `/reports` | Financial/calendar-year cash flow and category totals with CSV |
| `/settings` | Backup, restore, full export, reset, prices, preferences and database details |

Page heads, strips, tabs, drawers and tables reuse existing components. Filters and
selected tabs belong in the URL for refresh/back/forward. Deletes offer Undo;
the in-memory undo store does not survive a server restart. Linked Money rows open
their investment transaction instead of offering an independent edit.

## 8. Sample data

[scripts/seed.ts](../scripts/seed.ts) owns the deterministic invented dataset;
it sets the Sample data pill. Do not reproduce the dataset here or replace it with
real personal data. [tests/fixtures/portfolio-check.csv](../tests/fixtures/portfolio-check.csv)
is the hand-checked investment reference. Use isolated temporary databases for
automated tests and previews, not the owner's database.

## 9. Commands and operation

[README.md](../README.md) owns installation, environment setup, daily use,
backups/restores, reset, imports and price-fetch instructions. Its
[command table](../README.md#commands) reflects [package.json](../package.json).

## 10. Contributor conventions

[CLAUDE.md](../CLAUDE.md) owns always-on coding, privacy, dependencies, copy and
accessibility rules. Keep them there rather than duplicating them in this reference.

## 11. Completed phases and integration contracts

Phases 1-8 are implemented. Retain these numbers for existing code/test references:

| Phase | Delivered scope and enduring check |
|---|---|
| 1 | Foundation: shell, shared components, schema, seed/reset/backup, formatting and dates |
| 2 | Money: transactions, accounts, categories, balances; transfers excluded from cash-flow totals |
| 3 | Budgets: carry-forward, inline editing, copy and consistent Dashboard/Money totals |
| 4 | Investments: holdings, valuation, XIRR, linked Money rows; invented portfolio fixture agrees |
| 5 | Dashboard and Performance: matching cross-page figures, charts with zero/one/many points |
| 6 | Reports and Settings: validated backup/reset/restore round trip, full export, empty states |
| 7 | Value Research import: contracts below |
| 8 | Automatic prices: contracts below |

### Phase 7: Value Research import

- Read Transaction History `.xls` (BIFF8/OLE), both fund and stock sheets. Check
  without writing, then import buys/sales; list unsupported transaction types.
- Parse `DD-Mon-YY`, negative sales and charges from amount minus units times price.
  Adjust price when necessary to avoid negative charges while preserving money moved.
  Validate each sheet's Total against its rows.
- Match ISIN, offer same-name suggestions and manual mapping, allow asset-class
  correction. Count duplicates by investment/date/action/units so repeated all-time
  imports add only new rows. Oversells block import.
- Optionally link one Money account. Back up as `-pre-import` first, then apply all
  changes in one transaction. Tests construct invented XLS fixtures in memory.

### Phase 8: Automatic prices

- Only [lib/feeds.ts](../lib/feeds.ts) may make runtime network requests: public
  AMFI NAV and NSE/BSE whole-market files, never requests containing owner holdings.
  Use AMFI latest/history reports, NSE UDiFF/legacy bhavcopy, and BSE Equity-with-ISIN
  CSV (UDiFF from 8 July 2024) for ISINs absent from NSE. NSE takes precedence.
- Eligible investments are unit-valued funds, stocks and ETFs identified by ISIN.
  Save the file's date, not the download date; preserve manual/import prices.
- On open, check at most once per day when `auto_prices` is enabled (default).
  Record results in `price_update`; failed checks also count. Manual updates can
  force a fetch. Holding/group fetches do not mark the app-wide daily check complete.
- Backfill missing weekdays in the latest 30 days and Sunday week-ends before that,
  back to the first purchase of held, linked investments. Daily quotes must match
  the date; weekly lookback is at most seven days. Show a download estimate first.
- A single local worker checkpoints dates/assets in SQLite. Show progress and Stop
  across pages; resume interruptions on reopen, not while the server is stopped.
  A new run retries gaps and newly linked assets; do not retry failures forever
  within a run. Disabling automatic prices stops on-open fetches; explicit manual
  updates/backfills still download when requested.

## 12. Testing checklist (minimum)

For code changes, run `npm run lint`, `npm run typecheck` and `npm test`.
Use [tests/](../tests/) as the executable reference, including:

- **format:** Indian grouping, Lakh/Crore thresholds, negative and zero signs, `0.00%` not `−0.00%`.
- **money:** parsing "1,250.50", "₹ 1250", "1250.555" (reject more than 2 decimals), and empty input.
- **dates:** month boundaries, leap years, financial-year boundaries (31 Mar / 1 Apr).
- **balances:** income, spending, transfers in and out, opening date cut-off, credit card sign.
- **budgets:** carry-forward, amount 0, category without a budget.
- **holdings:** the section 6 vector; sell everything; split; bonus at price 0; oversell rejected; fees.
- **valuation:** latest price on or before a date; missing price falls back to the buy price; FD vector; simple interest; maturity cap.
- **xirr:** both section 6 vectors; all-negative flows return `null`; under-365-days produces "abs.".
- **performance:** daily available dates for short ranges, weekly for medium ranges, monthly for long/all-time; missing prices carried forward.
- **linked transactions:** create, edit and delete keep both sides in sync.

- **integrations:** duplicate import/oversells, price-source protection, interrupted
  backfill, migration compatibility, backup/reset/restore and ZIP round trips.

For UI work, check empty/populated states, keyboard focus and drawers, light/dark
themes and 360/768/1440px layouts using invented data. Charts need zero, one and
many points with readable labels/tooltips. Playwright is optional, not a required
new dependency. Documentation-only edits need link/reference and diff checks.

---

## 13. Decisions (settled)

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript (Next.js) | Owner uses Claude Code; one language across the stack |
| Hosting | Local only, 127.0.0.1, single user, no login | Personal data stays on the owner's machine |
| SQLite driver | Node's built-in `node:sqlite`, with Drizzle's official driver | Owner-approved Oct 2026: removes the separate SQLite native build on Windows; pinned Drizzle 1.0 RC and Node SQLite release-candidate APIs need careful upgrade tests |
| Styling | Port mockup CSS; no Tailwind | The design already exists as CSS |
| Charts | Custom SVG; no chart library | Matches the design exactly |
| Spending colour | Neutral text with −, not red | Red is reserved for losses and overspending |
| Dark mode | Follows system setting | Already designed in the mockup |
| Daily change | Each holding's last two available prices for 1 day; calendar dates for 1 week and longer | The latest NAV or close can predate today (weekends, holidays, delayed updates). Each holding can have different quote dates; remove money flows so a purchase is not counted as a gain |
| Automatic prices | AMFI, NSE and BSE whole-market files, once a day on open; optional backfill daily for the last 30 days and weekly before | Owner-approved (Oct 2026). Nothing about holdings is sent; a manual, stoppable backfill limits historical download volume |
| Cost method | Average cost | Simple and standard for tracking; not a tax calculation |
| Short holdings | Under 365 days show absolute return "abs." | Annualising short periods misleads |
| Investment payments | Optional "Paid from" / "Received in" creates a linked money transaction | Avoids entering SIPs twice |
| FD interest | Quarterly compounding by default, editable per FD | Common default in India |
| PPF / EPF / NPS | Balances entered by hand from statements | No reliable local calculation |
| Reports year | Financial year (April–March) by default | Matches Indian tax year |
| Delete | Immediate, with Undo toast | Fast, and still recoverable |

---

## 14. Backlog (after version 1)

- Import bank and card statements from CSV, with column mapping and duplicate detection.
- Recurring transactions (rent, SIPs, subscriptions) with reminders.
- Benchmark comparison (e.g. against an index) and inflation-adjusted returns.
- Tax view: capital gains by financial year using FIFO. This is not tax advice.
- Rule-based insights card ("Dining is 30% above your 3-month average").
- Split transactions across categories, attachments/receipts, multiple currencies.

---

## 15. Progress log

Keep outcomes brief; details and superseded decisions belong in Git history.

| Work | Status | Date | Outcome |
|---|---|---|---|
| Initial delivery (phases 1-8) | Done | 28 Sep-1 Oct 2026 | Money, budgets, investments, Dashboard, Reports, Settings, import and automatic prices implemented. |
| SQLite compatibility | Done | 1 Oct 2026 | Node SQLite, serial migration, pre-upgrade backups and LF/CRLF migration-hash compatibility. |
| Investment periods and prices | Done | 1 Oct 2026 | Flow-adjusted periods, quote-based daily gains, BSE fallback, resumable daily/weekly backfill and targeted fetch actions. |
| Chart history detail | Done | 1 Oct 2026 | Adaptive daily/weekly/monthly investment charts with calendar-time spacing and range-aware labels. |
| Documentation cleanup | Done | 3 Oct 2026 | Kept three purpose-specific docs; removed duplicate definitions, completed checklists and superseded implementation notes. |

Outstanding verification/limitations from delivery: holdings columns are not yet
sortable; end-to-end import with the owner's download and real-account balance
verification remain owner checks. The SQLite transition was tested on Windows
Node 26.7, not Node 24; do not describe the minimum-version path as tested.
