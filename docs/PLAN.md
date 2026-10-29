# Hisaab: product and calculation reference

This document holds the durable product rules, calculations, settled decisions and
backlog. Section numbers stay stable because code and tests refer to them.

## 0. Start here

- [README.md](../README.md) owns setup, operation and commands;
  [CLAUDE.md](../CLAUDE.md) owns coding, privacy, copy and design rules.
- Work one phase at a time, verify it, then summarise results before starting another.
- Get agreement before changing a settled decision in section 13.
- When behavior changes, update the section that owns it and add one short line to
  section 15. Git history holds the implementation detail.

## 1. Project summary

A personal finance web app for one owner in India, storing everything in one SQLite
file. It listens only on `127.0.0.1`; on the owner's VM, a tailnet-only
proxy is the sole way in. Currency is ₹ only, with Indian grouping (1,08,289) and
Lakh/Crore in headline figures.

- **Money:** income, spending, transfers between own accounts, balances, monthly
  budgets and SMS imports from the owner's paired phone.
- **Investments:** mutual funds, stocks, ETFs, gold, FDs, PPF, EPF, NPS and bonds,
  with cost, value, gains, XIRR and allocation.
- **Tax:** a new-regime income tax estimate for each financial year, with capital
  gains matched first in, first out. An estimate to check a return against, not advice.

Out of scope: logins or multiple users, cloud sync, bank or broker connections, tax
filing, the old regime, multiple currencies (see section 14).

## 2. Design

[DESIGN.md](../DESIGN.md) is the design system (the Refract redesign, 29 Oct 2026);
[docs/mockup.html](mockup.html) is the older reference and is kept for its invented
data. Tokens live in [styles/tokens.css](../styles/tokens.css), base styles in
[styles/globals.css](../styles/globals.css) and fonts in [app/fonts.ts](../app/fonts.ts):
Funnel Display for titles and big figures, Funnel Sans for everything else, with
tabular numerals for figures. The theme follows
the system unless the owner picks light or dark in the top bar. `/dev/ui` (development
only) shows shared components. Copy, colour, accessibility and layout rules are in
[CLAUDE.md](../CLAUDE.md#copy-and-design-rules). Labels, tabs, chips, tags and table
heads are sentence case and untracked, a deliberate change from the mockup's small
capitals (27 Oct 2026).

## 3. Architecture

Versions and scripts are in [package.json](../package.json). Next.js App Router,
strict TypeScript, Zod, decimal.js, Vitest, CSS Modules and custom SVG charts; no
Tailwind, UI kit or chart library. Node.js 24+ supplies `node:sqlite` through
Drizzle's `node-sqlite` driver (matching pinned 1.0 RC versions).

- Server Components read through `lib/queries`. Route handlers serve downloads, the
  service worker and the SMS receiver and pairing endpoints.
- Server Actions in `lib/actions` validate with Zod, write in a transaction,
  revalidate affected paths and return `{ ok: true, id? } | { ok: false, message, fieldErrors }`.
- `lib/db` is server-only: one shared connection with WAL and foreign keys.
- Existing databases are backed up before pending migrations or legacy-history
  upgrades. Builds migrate serially before Next's workers start. Known migration
  hashes match in LF or CRLF form; unknown history is rejected. A dev server that
  sees a newer schema asks for a restart instead of migrating mid-session.

## 4. Source map

| Location | Owns |
|---|---|
| `app/` | Routes, layouts and page composition |
| `components/` | Shared controls, drawers, tables and charts |
| `lib/db/` | Schema, migrations and connection |
| `lib/domain/` | Pure calculations and parsers |
| `lib/queries/`, `lib/actions/` | Database reads and writes |
| `lib/validation/` | Shared Zod schemas |
| `lib/feeds.ts` | The only runtime network requests |
| `scripts/` | Seed, reset, backup and migration tools |
| `tests/` | Tests and invented fixtures |
| `data/` | Local database and backups; never committed |

## 5. Data contracts

[lib/db/schema.ts](../lib/db/schema.ts) defines tables and constraints;
[lib/domain/assets.ts](../lib/domain/assets.ts) defines asset kinds, groups and defaults.

- Amounts are positive integer paise; the transaction type gives the direction.
  Income and expense need an account and a matching category. Transfers have no
  category and two different accounts; one side may be empty only for a linked
  investment transaction, where it means "Investments".
- Budgets apply to spending categories. The latest `start_month <= month` carries
  forward; zero switches the budget off from that month. Copying last month's
  budgets replaces this month's overrides.
- Accounts and categories with transactions are archived, not deleted. Sold
  investments can be archived. Account references are masked in the UI.
- Prices and valuations have one row per asset and date. Downloaded prices have
  `source = 'auto'` and never overwrite `manual` or `import` prices.
- Settings are JSON values by key: financial year starts in April, FD compounding
  is quarterly by default, `sample_data` shows the Sample data pill.
- Actions by kind (`actionsFor`): stocks and ETFs buy, sell, intraday, dividend,
  split, fee; mutual funds buy, sell, dividend, fee; gold buy, sell, fee; manual
  and FD kinds deposit, withdrawal, interest, fee. An edited row keeps its action.
- An intraday trade is one row: units, buy `price`, `sell_price`, `amount` = sale
  value − purchase value (each rounded to the paisa, negative for a loss) and fees.
- A mutual fund may set `nav_start_date` (NFO). The buy stays on its payment date
  at the entered price; no NAV is looked up before the start date.

### Linked money transactions

Choosing "Paid from" or "Received in" adds a Money row in the same transaction:

- Buy, deposit, fee: transfer from the account to Investments (amount + fees).
- Sell, withdrawal: transfer from Investments to the account (amount − fees).
- Intraday: amount − fees; a profit transfers in, a loss transfers out, break-even links nothing.
- Dividend, interest: income in the Dividends or Interest category.

The Money row stores `investment_txn_id` and is edited through the investment
transaction. Deleting either row removes both, with Undo.

### SMS imports

A paired phone posts SMS to the tailnet-only receiver; messages are stored
encrypted until decided. Pairing uses a one-time QR code (10 minutes, hashes only);
request-and-approve remains for older app versions. Current apps send batches of up
to 50 to `/api/sms/v2/batch` and check the connection with `/api/sms/v2/status`;
duplicates are matched across every pairing of the same installation. Approving a message can teach a
rule from its sender and structure; later messages that match exactly import
automatically, everything else waits for review. Transfers between own accounts
are supported; a matching transfer already in Money within three days is offered
for linking and is never auto-imported. Every decision is kept in History.

## 6. Calculations (`lib/domain`, pure and unit-tested)

### Formatting (`format.ts`)

- `formatINR` → `₹1,63,640` (no decimals; forms and price cells show 2).
- `formatShortINR`: ≥ 1 Crore `₹1.25 Cr`, ≥ 1 Lakh `₹21.71 Lakh`, else the full amount.
- Signs are `+` and `−` (U+2212); zero has none. Percentages show 2 decimals,
  "p.a." returns 1; anything rounding to zero is `0.00%`.
- Dates `27 Sep 2026` in tables, `27 Sep` in compact lists. Chart axes `0`, `75K`,
  `1.5L`, `2 Cr` with ticks of 1, 2, 2.5 or 5 × 10ⁿ.

### Money (`balances.ts`, `budgets.ts`)

- Balance on D = opening balance + income − spending − transfers out + transfers in,
  from the opening date to D.
- Month: income, spending, saved = income − spending, savings rate = saved ÷ income.
  Transfers are excluded.
- Budget: spent this month, left = budget − spent, over when spent > budget. The
  budget card totals only categories with a budget.
- Net worth = non-archived account balances (cards negative) + portfolio value. The
  Dashboard chart samples it from the first opening or investment transaction to
  the selected month, separates accounts and investments in its tooltip, and shows
  the change from first to last sample. Its optional Changes view plots each part
  relative to the first sample.

### Holdings (`holdings.ts`)

Replay each asset's transactions by date, then id:

- **Buy:** units += u; cost += u × price + fees.
- **Sell:** cost removed = (cost ÷ units) × u; realised += (u × price − fees) − cost
  removed; units −= u; cost −= cost removed. Selling more than held fails with
  "You only hold X units on that date."
- **Split:** units × (split_to ÷ split_from); cost unchanged.
- **Intraday:** realised += amount − fees; units and cost unchanged.
- **Deposit / withdrawal** (manual, FD): invested += / −= amount.
- **Dividend / interest:** income += amount. **Fee:** cost += amount.

Zero units (or zero invested for manual assets) counts as sold and is hidden
unless "Show sold investments" is on.

Test vector: buy 100 @ 50 fee 20, buy 50 @ 62 fee 10, sell 60 @ 70 fee 15 →
90 units, cost 4,878.00, realised gain 933.00.

### Current value (`valuation.ts`)

- **units:** units × latest price on or before the date; with no price, the last
  buy price, flagged "Price not updated".
- **manual:** latest valuation on or before the date + later deposits − later
  withdrawals; with none, net invested. A withdrawal beyond remaining cost is realised gain.
- **fd:** principal × (1 + r/n)^(n × t), t = days ÷ 365 to min(date, maturity);
  `simple` is principal × (1 + r × t). Vector: ₹1,00,000 at 7.10% quarterly for a
  year → ₹1,07,291.28.

### Returns

- **Total return** (holdings table) = current value − cost.
- **All-time return** = (value + sale/withdrawal proceeds + dividends/interest) −
  (buys, deposits and fees).
- **Change in period** (1 day, 1 week, 1/3/6 months, FY to date, 1/3 years, all):
  gain = end value + money out − start value − money in; percent = gain ÷ (start
  value + money in), "—" when that is zero. Groups and the portfolio combine their
  holdings' gains and flows. 1 day compares each holding's last two prices or
  statements (yesterday when it has fewer than two); longer periods use calendar
  dates. The Dashboard 1-day net-worth change uses cash changes since yesterday plus
  the latest investment price gain, excluding purchases already funded from cash.
  The Dashboard bridge splits any period's net-worth change into market moves (the
  period's investment gain, as in Change in period) and money in and out (the rest).

### XIRR (`xirr.ts`)

Negative flows: buys, deposits, fees, intraday losses. Positive: sales,
withdrawals, dividends, interest, intraday profits, and the current value on the
as-of date. 365-day year; Newton–Raphson from 0.1 (tolerance 1e-7, 100 iterations),
then bisection on [−0.9999, 100]; `null` without a sign change. Holdings younger
than 365 days show absolute return with "abs.". Groups and the portfolio combine flows.

Vectors: −10,000 on 2008-01-01, +2,750 on 2008-03-01, +4,250 on 2008-10-30,
+3,250 on 2009-02-15, +2,750 on 2009-04-01 → ≈ 0.3733625 (±1e-6);
−10,000 on 2023-01-01, +11,000 on 2024-01-01 → 0.10.

### Performance series (`performance.ts`)

Ranges up to 45 days plot each price, statement and transaction date; up to a
year, weekly; longer, month-ends. Points include the range start and end and are
spaced by calendar time. Invested = cost on that date; worth = value using the
latest known price or valuation. A single holding's chart also plots its
transaction dates. YTD follows the financial year.

The Investments Returns chart (`returns.ts`) plots gain ÷ (start value + money in)
for the portfolio and each investment type, with a gap where that is undefined; its
endpoint matches Change in period. Ranges: calendar YTD, 1/3/6 months, 1/3/5/10
years, All and Custom (default All for short histories, else 1 year).

Benchmarks are owner-chosen AMFI index fund ISINs (Settings suggests common
direct-growth index funds). A benchmark hypothetically buys the fund with the
starting value and mirrors buys, deposits, fees, sales and withdrawals (not
dividends, interest or intraday P&L). A missing required NAV or an uncovered
withdrawal makes the comparison unavailable; a missing chart-date NAV leaves a gap.
Up to eight benchmarks, selected in the URL.

### Allocation and movers

Allocation sums value by asset class or by display group. Top gainers and losers
show the top three each way for a period, group and value-or-percent sort.

### Tax (`taxRules.ts`, `capitalGains.ts`, `tax.ts`)

New regime only, April–March, from FY 2024-25 (`FIRST_TAX_YEAR`). `TAX_RULES` holds
each year's slabs, standard deduction (₹75,000), rebate limit and maximum, 4% cess,
₹1,25,000 long-term equity exemption and the surcharge threshold (₹50 lakh). Add a
year only after checking its figures against the Finance Act; a year without rules
shows its income but no tax.

- **Lots:** each sale is matched to the oldest units first. A lot's cost is units ×
  price plus the buy's fees; proceeds are the sale amount less fees, shared by units.
  Splits scale units and keep cost and date. Holdings elsewhere keep average cost.
- **Treatment** by holding period and the sale date (rates changed on 23 Jul 2024):
  - Stocks and equity funds: short-term up to 12 months at 15% then 20%; long-term at
    10% then 12.5%. Bought before 1 Feb 2018: left out (no grandfathering).
  - Non-equity funds bought from 1 Apr 2023 (from FY 2025-26 only debt funds): slab
    rates whatever the holding period.
  - Everything else: long-term after 24 months (ETFs 12) at 12.5%; sold before 23 Jul
    2024, long-term after 36 months is left out (may use indexation); short-term at
    slab rates.
- **Set-off:** losses net within their treatment, then a short-term loss goes against
  short-term equity, slab-rate, other long-term and long-term equity gains; a
  long-term loss against other long-term, then long-term equity. Higher rates first.
  What's left is shown as unused, not carried forward.
- **Income:** salary less the standard deduction, interest, dividends, other income,
  intraday profit (a loss is ignored) and slab-rate gains go through the slabs.
  Interest is investment interest (not PPF or EPF), what FD withdrawals took beyond
  the amount invested, and Money income in Interest not linked to an investment;
  dividends likewise. FD interest counts when received. Salary is the year's Money
  income in Salary (take-home), worked back to the gross whose new-regime tax on
  salary alone, taken as TDS, leaves that take-home; PF and other deductions are
  unknown. A typed Form 16 gross or TDS replaces the worked one (gross alone: TDS is
  its tax; TDS alone: gross is take-home plus TDS). Other TDS, tax paid, other income
  and replacements for the worked interest and dividends are typed per year
  (`tax_years`). The Other income category is not counted.
- **Tax:** slab tax by band; special-rate gains after the equity exemption, with any
  unused basic exemption set against them; the rebate when total income is within the
  limit, else marginal relief up to the slab tax; 4% cess; less TDS and tax paid.
- **Left out:** surcharge (flagged above the threshold), deductions other than the
  standard one, advance-tax interest, losses carried in from earlier years, and
  sales that are left out above. An oversold investment is listed to fix.

## 7. Screens

| Route | Purpose |
|---|---|
| `/` | One page period (1D to 1Y, default 1W); net worth with the bridge (market moves against money in and out), its line and the holdings that rose or fell most; Needs you (card bills due within 7 days with Pay, SMS waiting, prices, over-budget, overdrawn); the month so far (spent, left per day, earned, saved, spending pace against last month and the budget, budgets closest to their limit); accounts and cards with bill due dates; latest transactions |
| `/money` | Transactions with filters, totals and CSV |
| `/money/budgets` | Monthly budgets, inline editing, carry-forward, copy last month |
| `/money/accounts`, `/money/categories` | Create, edit and archive |
| `/money/sms` (+ `/history`, `/rules`, `/devices`) | Review queue with bulk actions and shortcuts; monthly decisions; learned rules; paired phones |
| `/investments` | Returns chart with benchmarks, grouped holdings, price fetches, statement updates |
| `/investments/performance` | As-of date and period, returns, chart, tables, CSV |
| `/investments/transactions` | Investment activity, running units, CSV |
| `/investments/[assetId]` | Holding summary, chart, transactions, FD details |
| `/investments/import` | Check and import Value Research history |
| `/reports` | Financial/calendar-year cash flow and category totals, CSV |
| `/tax` | One financial year's tax worked line by line, checks before filing, salary, TDS and other figures |
| `/tax/gains` | That year's sales by lot: bought, sold, cost, sale value, gain and how each is taxed |
| `/settings` | Backup, restore, export, reset, prices, benchmarks, preferences |

Filters, tabs and table sorting live in the URL. Data tables sort by every data
column (nulls last). Deletes offer Undo, held in memory until restart. Linked
Money rows open their investment transaction.

## 8. Sample data

[scripts/seed.ts](../scripts/seed.ts) owns the invented dataset and sets the Sample
data pill. [tests/fixtures/portfolio-check.csv](../tests/fixtures/portfolio-check.csv)
is the hand-checked investment reference. Tests and previews use temporary databases.

## 9. Commands and operation

See [README.md](../README.md#commands).

## 10. Contributor conventions

See [CLAUDE.md](../CLAUDE.md).

## 11. Phase contracts

Phases 1–8 are delivered: 1 foundation, 2 money, 3 budgets, 4 investments (the
invented portfolio fixture agrees), 5 Dashboard and Performance, 6 Reports and
Settings (backup → reset → restore round trip, full export), 7 and 8 below.

### Phase 7: Value Research import

- Read Transaction History `.xls` (BIFF8/OLE), fund and stock sheets. Check
  without writing, then import buys and sales; list unsupported types.
- Parse `DD-Mon-YY`, negative sales, and charges as amount − units × price,
  adjusting price rather than producing negative charges. Each sheet's Total must
  match its rows.
- Match by ISIN, suggest same-name matches, allow manual mapping and asset-class
  correction. Duplicates are matched by investment/date/action/units, so repeated
  imports add only new rows. Oversells block the import.
- Optionally link one Money account. Back up as `-pre-import`, then apply
  everything in one transaction.

### Phase 8: Automatic prices

- Only [lib/feeds.ts](../lib/feeds.ts) goes online: AMFI NAV files and NSE/BSE
  whole-market bhavcopy. Nothing about holdings is sent. NSE takes precedence; BSE
  covers ISINs NSE lacks. Funds, stocks and ETFs with an ISIN are eligible. Save
  the file's date, not the download date.
- When `auto_prices` is on (default), check the latest prices once a day on open;
  failed checks count. Manual and per-holding updates can always fetch.
- **Daily backfill** requests each missing weekday from the first purchase of each
  held, linked investment up to yesterday (today belongs to the daily check), one
  whole-market download per source and date, after
  showing an estimated size. A single worker checkpoints progress in SQLite, shows
  progress and Stop across pages, and resumes on reopen.
- **Files not out yet:** within three days (`PUBLISH_GRACE_DAYS`) of a date, an
  AMFI web page or an empty BSE file means "not published yet". The date is left
  for a later run without an error.
- **After three days:**
  - NSE and BSE both without a file is an exchange holiday: cached in
    `price_no_market_file_dates` and never fetched again for listed investments,
    even when AMFI publishes a holiday NAV list.
  - A published file that doesn't list an investment records that investment and
    date in `price_absent_dates`, and it is skipped. Settings shows how many and
    offers "Check them again", which clears the list.
- **Failures:** a date whose source fails is reported and skipped for the rest of
  the run; the run continues and ends with a count of dates it couldn't fetch. The
  run stops only when a source can't be reached (network error or server error).
  A new run retries everything not settled.
- NFO funds carry the entered allotment price forward until the first NAV date.

## 12. Testing checklist

Run `npm run lint`, `npm run typecheck` and `npm test` for every code change, and
build with a temporary `DATABASE_PATH`. [tests/](../tests/) is the executable
reference and covers: formatting, money parsing, dates (leap years, 31 Mar/1 Apr),
balances, budgets, the section 6 holdings, FD and XIRR vectors, valuation fallbacks,
performance cadence, linked transactions, imports, price-source protection,
backfill interruption and gaps, migrations, and backup/restore/ZIP round trips.

For UI work, check empty and populated states, keyboard focus, drawers, both themes
and 360/768/1440px widths with invented data. Charts need zero, one and many points.

## 13. Decisions (settled)

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript (Next.js) | One language across the stack |
| Hosting | `127.0.0.1` only, single user, no login; tailnet-only proxy on the VM | Personal data stays private |
| SQLite driver | Node's `node:sqlite` with Drizzle's driver | No native build on Windows; upgrade carefully |
| Styling | Mockup CSS, CSS Modules, no Tailwind | The design already exists as CSS |
| Charts | Custom SVG | Matches the design exactly |
| Spending colour | Neutral text with − | Red is for losses and overspending |
| Daily change | Each holding's last two prices for 1 day; calendar dates otherwise | Quotes can predate today; flows aren't gains |
| Automatic prices | AMFI, NSE and BSE whole-market files, daily on open, optional backfill | Nothing about holdings is sent |
| Unpublished prices | Missing after three days counts as not published; owner can recheck | Stops repeated downloads of holidays and unlisted dates |
| Cost method | Average cost for holdings, first in, first out for tax | Simple on screen; FIFO matches how sales are taxed |
| Tax year | Fixed April–March, new regime only | The owner files under the new regime |
| Short holdings | Under 365 days show "abs." | Annualising short periods misleads |
| Investment payments | Optional linked Money transaction | Avoids entering SIPs twice |
| FD interest | Quarterly by default, editable | Common in India |
| PPF / EPF / NPS | Balances from statements | No reliable local calculation |
| Reports year | Financial year (April–March) | Matches the Indian tax year |
| Delete | Immediate, with Undo | Fast and recoverable |

## 14. Backlog

- Bank and card statement CSV import with column mapping and duplicate detection.
- Recurring transactions with reminders.
- Inflation-adjusted returns and official index levels.
- Rule-based insights ("Dining is 30% above your 3-month average").
- Split transactions, receipts, multiple currencies.

## 15. Progress log

| Work | Date | Outcome |
|---|---|---|
| Phases 1–8 | 28 Sep–1 Oct 2026 | Money, budgets, investments, Dashboard, Reports, Settings, import, automatic prices. |
| Prices and charts | 1–6 Oct 2026 | Node SQLite, flow-adjusted periods, BSE fallback, daily backfill with size estimate, NFO first-NAV dates, adaptive chart cadence. |
| Tables and Dashboard | 7 Oct 2026 | Sortable tables everywhere; Dashboard leads with investments and a Needs-attention strip. |
| SMS imports | 7–11 Oct 2026 | Encrypted receiver, QR pairing, review workspace, learned rules, transfers, parser v3, History. |
| Investments | 12–13 Oct 2026 | Intraday trades, Returns chart with AMFI benchmarks and suggestions, net-worth chart, wider layout. |
| Unpublished prices | 22 Oct 2026 | Backfill waits for recent files, caches exchange holidays despite AMFI holiday lists, records settled missing prices with a recheck, leaves today to the daily check, and no longer stops on one bad date. |
| Move and UI polish | 27 Oct 2026 | Live install and development moved to the Pi. Hallmark audit polish: sentence-case labels and tabs, no dashes or middle-dot separators, field focus outline, import and card spacing, single table heads, 4px spacing, no-ISIN no longer a failed price update, blank future months and empty % p.a. Floor 35 to 1 (a checker false positive), Reflex 139 to 0. |
| Dashboard redesign | 28 Oct 2026 | Rebuilt around three jobs: how wealth moved, what needs action, whether the month is on track. Card accounts gain a bill due day; Allocation, returns by type, income vs spending and the spending donut moved off the Dashboard to Investments and Reports; the month picker went. |
| Tax tab | 28 Oct 2026 | New-regime estimate from FY 2024-25: FIFO capital gains with set-off, interest and dividends from Money and Investments, hand-entered salary and TDS, rebate, marginal relief and cess, and a sales table. FY 2026-27 rules wait for verified figures. Salary and TDS are then worked back from take-home pay in Money, with Form 16 figures as optional replacements. |
| Refract redesign | 29 Oct 2026 | Hallmark full redesign in the Refract theme, locked in `DESIGN.md`: warm white paper, pool-blue ink and one blue for actions, Funnel Display over Funnel Sans with tabular numerals, white cards with tinted shadows, pill controls, light and dark modes. Every link, field and handler kept; Floor 3 to 1 (the same checker false positive), Reflex 4 to 0. |
| SMS protocol v2 | 30 Oct 2026 | Batch receiver at `/api/sms/v2/batch` (up to 50 SMS, one result each) and a connection check at `/api/sms/v2/status`. Errors carry a code; a wrong or revoked token now returns 401 so the app knows to pair again; a missing encryption key returns 503 instead of a crash. Duplicates are matched across re-pairings of the same phone. Version 1 still works. |

Owner checks still open: an end-to-end import with a real download and real-account
balance verification. The SQLite path was tested on Node 26.7, not Node 24.
