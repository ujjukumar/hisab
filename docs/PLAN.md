# Hisaab: personal finance app — context and implementation plan

This document is the complete brief for building the app. It was written after a planning and mockup phase with the owner. Read all of it before writing code.

---

## 0. Start here (instructions for Claude Code)

1. Read this whole file, then open `docs/mockup.html` in a browser (or read its source). The mockup is the approved visual and interaction design and is the source of truth for look and feel.
2. Work one phase at a time (section 11). At the end of each phase, run the acceptance checks, then stop and summarise for the owner before starting the next phase.
3. In Phase 1, create a short `CLAUDE.md` in the repo root from section 10 (Conventions) and the commands in section 9, so the rules load in every session. Keep this file as `docs/PLAN.md`.
4. Keep the Progress log (section 15) up to date as phases complete.
5. The decisions in section 13 are settled. If something in this plan turns out to be wrong or impractical, explain why and propose an alternative before deviating.
6. Never put the owner's real financial data in seed files, fixtures, tests, screenshots or commit messages. All sample data is invented.

Expected starting folder (the owner will create it):

```
hisaab/
  PLAN.md              → move to docs/PLAN.md in Phase 1
  hisaab-mockups.html  → move to docs/mockup.html in Phase 1
```

---

## 1. Project summary

**What:** a personal finance web app that runs only on the owner's computer at `http://127.0.0.1:3000`, storing everything in one SQLite file.

**Who:** a single user based in India. Currency is ₹ (INR) only. Numbers use Indian grouping (1,08,289) and Lakh/Crore abbreviations in headline figures.

**Two areas:**

- **Money:** income, spending, transfers between own accounts, account balances, monthly budgets per category.
- **Investments:** holdings, cost, current value, gains, annualised returns (XIRR), allocation. Instruments the owner uses or may use: mutual funds, stocks, ETFs, gold (ETFs and gold bonds), fixed deposits, PPF, EPF, NPS, bonds.

**Not in version 1:** logins or multiple users, cloud sync, bank or broker connections, automatic price feeds, tax reports, multiple currencies, a mobile app. (See the backlog in section 14.)

---

## 2. Design

### 2.1 Source of truth

`docs/mockup.html` is a single self-contained HTML file with inline CSS and JavaScript and invented sample data. It contains:

- **Dashboard:** month title, summary strip, and cards for income vs spending (bar chart), where your money went (donut), portfolio performance (line chart), allocation (donut), budgets, recent transactions, returns by investment type, top gainers and losers, accounts.
- **Money → Transactions:** summary strip, tabs, filter bar, sortable table, totals row, row menus.
- **Investments → Overview:** summary strip, tabs, sub-tabs by investment type, one table per type with totals.
- **Add/edit transaction drawer** (Spending / Income / Transfer) and **add investment transaction drawer** (Buy / Sell / Dividend).
- Row "⋮" menus, toasts, placeholder states for unbuilt tabs.
- Light theme plus a dark theme that follows the system setting.

**Port the mockup's CSS rather than reinventing it.** Its `:root` tokens, component styles and responsive rules should move into the app nearly unchanged. Its chart functions (`drawBars`, `drawLine`, `donut`) and number formatters are the reference implementations for the React versions.

The look is inspired by an Indian portfolio tracker's style (warm peach page, flat white cards, one strong blue, green/red only for gains/losses). Do not copy any third-party logo, name, image or asset. "hisaab" (lowercase serif wordmark followed by a small orange dot) is a placeholder brand name.

### 2.2 Tokens (summary; the mockup CSS is authoritative)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | `#FEF1E8` | `#17120F` | Page background behind cards |
| `--surface` | `#FFFFFF` | `#221C18` | Cards, top bar, page head, drawer |
| `--line` / `--line-strong` | 10% / 24% black | 10% / 24% white | Borders and dividers |
| `--zebra` | `#F5F5F5` | 3.5% white | Alternate table rows |
| `--heading` / `--text` | `#000` / `#212529` | `#FFF` / `#ECE6E1` | Text |
| `--text-2/3/4` | 80% / 60% / 40% black | 80% / 60% / 38% white | Secondary, labels, faint |
| `--primary` | `#1C509D` | `#8CB0EC` | Links, active tabs, names, outlines |
| `--primary-btn` | `#1C4DA0` | `#2F63B8` | Filled button background |
| `--gain` / `--loss` | `#12783C` / `#B91014` | `#5CCB8A` / `#FF7B73` | Gains and losses only |
| `--accent` | `#FFA500` | same | Brand dot, dot before each holding |
| `--c1`…`--c8` | muted blue, sage, brown, mauve, olive, slate, ochre, light blue | lighter versions | Charts and category colours |

Type:

- **IBM Plex Sans** for the interface (400/500/600).
- **IBM Plex Mono** (500) for figures in tables and lists, right-aligned, tabular numerals.
- **Fraunces** (variable, `SOFT` 100, `WONK` 0, weight ~400) for card, table and drawer titles.
- Sizes: 10px uppercase semibold labels above figures and on field borders; 13–14px body and tables; 20–25px titles; 30px headline figures (23px on mobile).

Shapes: cards 5px radius, table cards 10px, 1px borders, no card shadows. The top bar has a faint 1px shadow. Buttons are 5px radius; the secondary button has a 2px primary-coloured border.

### 2.3 Components to build (all visible in the mockup)

TopBar, PageHead (title, actions, StatStrip, Tabs), SubTabs, Card (title, subtitle, footer "See … ›" link), Chips (time-range and grouping toggles), Field (floating label on the border; text, number, date, select, search, date range), Button (primary, secondary, icon), DataTable (sortable headers with small uppercase sub-labels, two-line cells, zebra rows, totals footer, row menu, horizontal scroll on small screens, empty state), Drawer (focus trap, Esc closes, backdrop click closes), Menu (keyboard accessible), Toast (with optional Undo action), Segmented control, BudgetBar, LegendList, Donut, BarChart, LineChart (hover crosshair and tooltip), GainLoseTiles.

### 2.4 Rules the design follows

- **Colour meaning:** green and red are only for gains/losses and over-budget warnings. Spending amounts are shown in the normal text colour with a minus sign (−, U+2212), not red. Transfers are grey.
- **Tables** show plain numbers without ₹ and a footnote "All amounts in ₹." Cards and strips show ₹.
- **Copy:** sentence case, plain words, active verbs. A button says what it does ("Save transaction"), and the toast uses the same words ("Transaction saved"). Errors say what's wrong and how to fix it, without apologising ("Enter an amount greater than zero."). Empty states invite an action ("No transactions match these filters." + "Clear filters").
- **Accessibility:** visible keyboard focus, tabs use `role="tab"` with `aria-selected`, sortable headers use `aria-sort`, menus are keyboard reachable, drawers trap focus and return focus on close, `prefers-reduced-motion` disables transitions, colour is never the only signal (signs and labels too).
- **Responsive:** works down to ~360px. Grids collapse to one column, the main nav wraps to a scrollable second row, tables scroll horizontally inside their card.

### 2.5 Screens that were not mocked

Budgets, Accounts, Categories, Investments → Performance, Investments → Transactions, holding detail, Reports and Settings were not mocked. Build them from the same components and patterns (page head + strip + tabs, filter bar, table cards, drawers). Section 7 describes each one.

---

## 3. Tech stack

Use the current stable version of each package at install time and pin it in `package.json`.

| Part | Choice |
|---|---|
| Framework | Next.js (App Router), React, TypeScript in strict mode |
| Database | SQLite through `better-sqlite3`, with Drizzle ORM and `drizzle-kit` for migrations |
| Validation | Zod, on every server action |
| Exact maths | `decimal.js` for anything involving units, prices, rates or division |
| Styling | Global `styles/tokens.css` + `styles/globals.css` (ported from the mockup) and one CSS Module per component. **No Tailwind and no UI kit.** |
| Charts | Custom SVG React components ported from the mockup. **No chart library.** |
| Fonts | `next/font/google` (downloads fonts at build time and serves them locally) |
| Tests | Vitest for domain logic. Playwright smoke tests are optional (Phase 6). |
| Lint/format | ESLint (Next.js config) + Prettier |
| Package manager / runtime | npm, Node.js LTS |

Architecture:

- **Reads:** Server Components call functions in `lib/queries/*`, which use the database directly. There is no separate REST API.
- **Writes:** Server Actions in `lib/actions/*`. They validate with Zod, write inside a DB transaction, call `revalidatePath` for affected pages, and return `{ ok: true, id? } | { ok: false, message, fieldErrors }`.
- **Client components** only where interaction needs it: drawers, filters, menus, chart hover, chips, toasts.
- **Route handlers** only for file downloads (CSV export, backup download).
- `lib/db` imports `server-only`. Use one shared database connection, cached on `globalThis` in development to survive hot reload. On open, set `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`.
- If Next.js has trouble bundling `better-sqlite3`, add it to `serverExternalPackages` in `next.config`.

---

## 4. Project layout

```
hisaab/
  app/
    layout.tsx                  fonts, tokens, TopBar, Toast provider
    page.tsx                    Dashboard (?month=YYYY-MM)
    money/
      layout.tsx                PageHead + strip + tabs for Money
      page.tsx                  Transactions
      budgets/page.tsx
      accounts/page.tsx
      categories/page.tsx
    investments/
      layout.tsx                PageHead + strip + tabs for Investments
      page.tsx                  Overview (?group=…&sold=1)
      performance/page.tsx
      transactions/page.tsx
      [assetId]/page.tsx        Holding detail
    reports/page.tsx
    settings/page.tsx
    api/export/…                CSV and backup downloads (route handlers)
    dev/ui/page.tsx             Component showcase (only renders in development)
  components/                   one folder per component: Name.tsx + Name.module.css
    charts/                     BarChart, LineChart, Donut
  lib/
    db/
      schema.ts                 Drizzle tables
      client.ts                 connection, pragmas, auto-migrate with backup
      migrations/               generated by drizzle-kit
    queries/                    money.ts, budgets.ts, investments.ts, dashboard.ts, reports.ts
    actions/                    transactions.ts, accounts.ts, categories.ts, budgets.ts, assets.ts, investmentTransactions.ts, prices.ts, settings.ts
    domain/                     pure functions, fully unit-tested
      money.ts                  paise helpers, parsing user input
      format.ts                 INR, Lakh/Crore, signs, percents, dates
      dates.ts                  date-only helpers (no timezone bugs)
      balances.ts
      budgets.ts
      holdings.ts               average cost, realised gains, splits
      valuation.ts              prices, manual valuations, FD maths
      xirr.ts
      performance.ts            monthly invested vs worth series
    validation/                 Zod schemas shared by actions and forms
  styles/
    tokens.css
    globals.css
  scripts/
    seed.ts                     loads the invented sample data
    reset.ts                    wipes data, restores default categories
    backup.ts
  tests/                        mirrors lib/domain
  data/                         finance.db and backups/ (gitignored)
  docs/
    PLAN.md
    mockup.html
  CLAUDE.md
```

---

## 5. Data model

General rules:

- **Money** is stored as INTEGER paise. ₹1,250.50 → `125050`.
- **Units and prices** are stored as TEXT decimal strings (up to 4 decimal places, e.g. `"1660.1200"`, `"231.4600"`). Parse them with `decimal.js`. Never multiply units by prices using plain JavaScript numbers.
- **Interest rates** are stored as TEXT decimals in percent (e.g. `"7.10"`).
- **Dates** are TEXT `YYYY-MM-DD` (local date, owner is in India). Timestamps are TEXT ISO 8601. Months are TEXT `YYYY-MM`.
- Every table has `id INTEGER PRIMARY KEY`, `created_at`, `updated_at`, unless noted.
- Records that other records depend on are archived, not deleted.

### accounts

| Column | Type | Notes |
|---|---|---|
| name | TEXT NOT NULL UNIQUE | "Salary account" |
| type | TEXT NOT NULL | `bank` · `card` · `cash` · `wallet` · `other` |
| opening_balance | INTEGER NOT NULL DEFAULT 0 | paise, signed. Money owed on a card is negative. |
| opening_date | TEXT NOT NULL | balance is as of this date |
| note | TEXT | e.g. "due 5th of each month" |
| archived | INTEGER NOT NULL DEFAULT 0 | |
| sort_order | INTEGER NOT NULL DEFAULT 0 | |

### categories

| Column | Type | Notes |
|---|---|---|
| name | TEXT NOT NULL | |
| kind | TEXT NOT NULL | `income` · `expense` |
| color | TEXT NOT NULL | a token name `c1`…`c8` |
| archived | INTEGER NOT NULL DEFAULT 0 | |
| sort_order | INTEGER NOT NULL DEFAULT 0 | |
| | | UNIQUE(name, kind) |

Default categories created on first run and after reset:

- Spending: Housing, Groceries, Dining, Transport, Shopping, Utilities, Health, Entertainment, Education, Travel, Insurance, Personal care, Gifts, Other.
- Income: Salary, Freelance, Dividends, Interest, Refunds, Other income.

### transactions (money side)

| Column | Type | Notes |
|---|---|---|
| date | TEXT NOT NULL | |
| type | TEXT NOT NULL | `income` · `expense` · `transfer` |
| amount | INTEGER NOT NULL CHECK (amount > 0) | paise, always positive |
| account_id | INTEGER NULL → accounts | The account for income/spending; the source account for a transfer |
| to_account_id | INTEGER NULL → accounts | Destination of a transfer |
| category_id | INTEGER NULL → categories | Required for income/spending, empty for transfers |
| description | TEXT NOT NULL | |
| note | TEXT | |
| investment_txn_id | INTEGER NULL → investment_transactions ON DELETE CASCADE | Set when created automatically by an investment transaction |

CHECK constraints:

- `income`/`expense`: `account_id` NOT NULL, `category_id` NOT NULL, `to_account_id` IS NULL.
- `transfer`: `category_id` IS NULL. At least one of `account_id` / `to_account_id` is set. A missing side is only allowed when `investment_txn_id` is set (that side is the investment portfolio, shown as "Investments"). `account_id != to_account_id`.

The app (Zod) also checks that the category's kind matches the type.

Indexes: `(date)`, `(account_id, date)`, `(to_account_id, date)`, `(category_id, date)`.

### budgets

| Column | Type | Notes |
|---|---|---|
| category_id | INTEGER NOT NULL → categories | spending categories only |
| start_month | TEXT NOT NULL | `YYYY-MM` |
| amount | INTEGER NOT NULL | paise. 0 means "no budget from this month". |
| | | UNIQUE(category_id, start_month) |

The budget for month M is the row with the latest `start_month <= M`. Budgets therefore carry forward until changed.

### assets (investments)

| Column | Type | Notes |
|---|---|---|
| name | TEXT NOT NULL | "Meridian Flexi Cap Direct-G" |
| type | TEXT NOT NULL | `mutual_fund` · `stock` · `etf` · `gold` · `fixed_deposit` · `ppf` · `epf` · `nps` · `bond` · `other` |
| asset_class | TEXT NOT NULL | `equity` · `debt` · `gold` · `other`. Default from type, editable (a debt mutual fund is `debt`). |
| valuation | TEXT NOT NULL | `units` (units × price) · `manual` (entered balances) · `fd` (calculated from rate) |
| symbol | TEXT | ticker, ISIN or scheme code, optional |
| account_ref | TEXT | folio or demat number. Show masked as "Folio ••7731". |
| interest_rate | TEXT | percent, for `fd` and `bond` |
| compounding | TEXT | `quarterly` (default) · `monthly` · `half_yearly` · `yearly` · `simple` |
| start_date / maturity_date | TEXT | for `fd`, `bond`, `ppf` |
| note | TEXT | |
| archived | INTEGER NOT NULL DEFAULT 0 | |

Display groups (Overview sub-tabs and tables, in this order): **Mutual funds** (`mutual_fund`), **Stocks & ETFs** (`stock`, `etf`), **Gold** (`gold`), **Fixed income** (`fixed_deposit`, `bond`, `ppf`, `epf`), **NPS** (`nps`), **Other** (`other`). Only show groups that have holdings.

Default valuation by type: `units` for mutual_fund, stock, etf, gold; `fd` for fixed_deposit; `manual` for ppf, epf, nps, bond, other.

### investment_transactions

| Column | Type | Notes |
|---|---|---|
| asset_id | INTEGER NOT NULL → assets | |
| date | TEXT NOT NULL | |
| action | TEXT NOT NULL | `buy` · `sell` · `split` (units assets); `deposit` · `withdrawal` (manual/fd assets); `dividend` · `interest` (cash paid out to you); `fee` |
| units | TEXT | buy/sell |
| price | TEXT | per unit, buy/sell |
| amount | INTEGER | paise. Buy/sell: units × price rounded to paise. Deposit, withdrawal, dividend, interest, fee: the amount. |
| fees | INTEGER NOT NULL DEFAULT 0 | paise (brokerage, stamp duty) |
| split_from / split_to | INTEGER | e.g. 1 → 5 for a 1:5 split. Bonus issues are recorded as a buy at price 0. |
| note | TEXT | |

Index: `(asset_id, date)`.

**Linked money transactions.** When the owner records a buy, deposit or fee and picks a "Paid from" account, or a sell, withdrawal, dividend or interest and picks a "Received in" account, create the matching row in `transactions` in the same DB transaction, with `investment_txn_id` set:

- Buy / deposit / fee → transfer from that account to "Investments" (`to_account_id` NULL). Amount = amount + fees.
- Sell / withdrawal → transfer from "Investments" (`account_id` NULL) to that account. Amount = amount − fees.
- Dividend / interest → income, in category Dividends or Interest.

Linked rows are shown on the Money side with a small "Linked" label. Their row menu offers "Open investment transaction" instead of Edit. Editing the investment transaction updates the linked row. Deleting either deletes both, and the toast offers Undo.

### prices

| Column | Type | Notes |
|---|---|---|
| asset_id | INTEGER NOT NULL → assets | |
| date | TEXT NOT NULL | |
| price | TEXT NOT NULL | |
| source | TEXT NOT NULL DEFAULT 'manual' | `manual` · `import` |
| | | PRIMARY KEY(asset_id, date), no `id` column |

### valuations

| Column | Type | Notes |
|---|---|---|
| asset_id | INTEGER NOT NULL → assets | |
| date | TEXT NOT NULL | |
| value | INTEGER NOT NULL | paise, balance from a statement |
| | | PRIMARY KEY(asset_id, date), no `id` column |

### settings

`key TEXT PRIMARY KEY`, `value TEXT` (JSON).

Keys:

- `financial_year_start_month`: `4`, meaning April–March.
- `default_fd_compounding`: `"quarterly"`.
- `sample_data`: `true` while sample data is loaded, which shows the "Sample data" pill in the top bar.

---

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
- **`manual`:** latest valuation on or before the date. If there is none, use the net amount invested.
- **`fd`:**
  - Formula: principal × (1 + r/n)^(n × t), where t is in years (days ÷ 365) from start to min(date, maturity). `simple` compounding means principal × (1 + r × t).
  - Test: ₹1,00,000 at 7.10% compounded quarterly for 1 year → ₹1,07,291.28.

### Returns

- **Total return** (holdings table) = current value − cost. This is the unrealised gain.
- **All-time returns** (Investments strip) = (current value + all sale and withdrawal proceeds + dividends and interest received) − (all buy and deposit amounts + fees). This equals unrealised + realised gains + income.
- **Change since last update:** this replaces the mockup's "1 day change" (decision in section 13).
  - For each `units` holding: units × (latest price − previous price).
  - Percent = change ÷ value at previous price.
  - The portfolio figure is the sum across holdings. The label shows the date of the previous price, e.g. "Since 21 Sep".
  - Holdings with fewer than two prices show "—".

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

For each month-end from the first investment transaction to today, plus today as the last point:

- **Invested** = total cost of holdings on that date (same rules as above).
- **Worth** = value of holdings on that date, using the latest price or valuation known on or before it.

Chips select All time, YTD, 6M, 1Y and 3Y. YTD follows the financial year (April start) on the Performance tab and the calendar year on the Dashboard card, and each is labelled clearly.

### Allocation

- **By asset:** sums of value by `asset_class`.
- **By investment type:** sums of value by display group.

### Top gainers and losers

The top 3 holdings each way by change since last update, as a value or percent. Filters: investment group, and sort by value or %.

---

## 7. Screens

Each Money and Investments page has a PageHead: title, actions, summary strip and tabs. Filters and selected tabs live in the URL so refresh and back/forward work.

### Dashboard `/` (mocked)

- **Title:** the month name, with a month picker (`?month=YYYY-MM`, default current month).
- **Action:** "Add transaction".
- **Strip:** Net worth (+ change since last update), Investments (+ invested), Spent this month (of budget), Saved this month (% of income).
- **Cards, layout as the mockup:**
  - Income vs spending: 6M / 1Y bars, with a tooltip showing income, spending and saved.
  - Where your money went: by category or by account.
  - Portfolio performance.
  - Allocation.
  - Budgets.
  - Recent transactions: the last 6.
  - Returns by investment type: duration "Since last update" or "All time". Groups without holdings show "Not added + Add".
  - Top gainers and losers.
  - Accounts, with an "In bank and cash" total.
- Each card footer links to the matching page.

### Money → Transactions `/money` (mocked)

- **Strip:** Income this month (+ number of payments), Spent (of budget), Saved (% of income), In bank and cash (+ number of accounts).
- **Tabs:** Transactions, Budgets, Accounts, Categories.
- **Filter bar:** Duration (from–to, defaults to the current month), Type, Category, Account (matches the source or destination), Search (description and note).
- **Title:**
  - "September 2026 (n)" when the range is exactly one calendar month.
  - Otherwise "Transactions (n)".
- **Table columns:** Date, Description (+ note), Category (dot + name), Account, Amount (+ "to X" for transfers), ⋮.
  - Sort by date or amount.
  - Totals row: + income, − spent.
  - Show 100 rows, then a "Show more" button.
- **Row menu:** Edit, Duplicate, Delete.
  - Delete takes effect immediately, and the toast offers Undo for about 6 seconds.
  - Linked rows: "Open investment transaction", Delete.
- **Export CSV** downloads the currently filtered rows.
- **Drawer:** as mocked (segmented type, big amount field, date, category, account / from + to, description, optional note), with inline errors. Enter saves.

### Money → Budgets `/money/budgets`

- A month picker.
- **Table columns:** Category, Budget (editable inline; saves on blur or Enter), Spent, Left, progress bar.
  - A totals row.
  - A "Copy last month's budgets" action.
  - Categories without a budget are listed below with "Set budget".
- Over-budget rows use `--loss` for the Left figure and the bar.

### Money → Accounts `/money/accounts`

- **Table columns:** Account (+ type), Opening balance (+ date), Current balance, Last transaction date, ⋮ (Edit, Archive).
- "Add account" opens a drawer.
- Accounts with transactions can be archived, not deleted. Archived accounts are hidden behind a "Show archived" toggle.

### Money → Categories `/money/categories`

- Two table cards: Spending and Income.
- **Columns:** colour dot + name, Transactions this year, Spent/received this year, ⋮ (Rename, Change colour, Archive).
- "Add category" opens a drawer.
- A category with transactions can only be archived.

### Investments → Overview `/investments` (mocked)

- **Strip:** Current value (+ invested), Change since last update (+ %), All-time returns (+ % p.a.).
- **Tabs:** Overview, Performance, Transactions.
- **Sub-tabs:** All + one per display group that has holdings.
- One table card per group. Header actions: "Update prices" (units groups only) and "Download CSV".
- **Columns:**
  - Name (+ folio/demat, masked)
  - Last price (+ date)
  - Since last update (+ %)
  - Total cost (+ cost per unit)
  - Current value (+ units)
  - % of portfolio
  - Total return (+ % p.a. or abs.)
  - ⋮ (Record transaction, Update price, See transactions, Edit investment, Archive)
- Totals row per group.
- "Show sold investments" toggle (`?sold=1`). Sold rows show their realised gain.
- The name links to the holding detail page.
- **Update prices drawer:** every holding in the group with its last price, a new price field and one date field, then "Save prices".
- **Add investment:**
  - Picking "New investment…" in the investment select opens fields for name, type, asset class, account ref, and the rate/dates for FDs.
  - Then comes the transaction part as mocked: Buy / Sell / Dividend, plus Deposit / Withdrawal for manual and FD assets. Fields: date, units, price, fees, an optional "Paid from" / "Received in" account, and a live total.

### Investments → Performance `/investments/performance`

- **Filter bar:** As of (date), Period (Since last update / 1M / 3M / 6M / 1Y / 3Y / All time).
- **Aggregate card:** total return % and XIRR for the period, plus an "Export CSV" button.
- **Performance graph:** amount invested vs current worth (LineChart).
- **One table per group, columns:** Name, Current value, Invested, Gain in period, % absolute, % p.a., with a totals row.
- Comparison against an index and inflation-adjusted returns are in the backlog.

### Investments → Transactions `/investments/transactions`

- **Filter bar:** Duration, Action, Group, Search.
- **Table columns:** Date, Investment (+ account ref), Action, Price, Units (+/−), Balance units (after this transaction), Amount, Linked account, ⋮ (Edit, Delete).
- Export CSV.

### Holding detail `/investments/[assetId]`

- **Page head:** name, type and account ref.
- **Strip:** Current value (+ invested), Since last update, Total return (+ p.a.).
- **Actions:** Record transaction, Update price, and ⋮ (Edit investment, Archive).
- **Cards:**
  - Price history (LineChart of `prices`, or valuations for manual assets).
  - Transactions table.
  - For FDs: principal, rate, compounding, maturity date and maturity value.

### Reports `/reports`

- Year selector with a Financial year (Apr–Mar) / Calendar year toggle; financial year is the default.
- **Strip:** Income, Spending, Saved, Savings rate, Net invested in the year.
- **Cards:**
  - Monthly income vs spending (BarChart).
  - Spending by category: a table of categories × months with a total column.
  - Income by category.
- Export CSV.

### Settings `/settings`

- **Data:**
  - "Back up now" (downloads a copy and also saves one to `data/backups/`).
  - "Restore from backup" (upload a `.db`; validate it before replacing; back up the current file first).
  - "Export everything as CSV" (zip).
  - "Remove sample data and start fresh": requires typing `DELETE`, then wipes all tables and recreates the default categories.
- **Preferences:** financial year start month, default FD compounding.
- **About:** database file path and size, app version.

---

## 8. Sample data (`scripts/seed.ts`)

Recreate the mockup's invented dataset so the built app looks like the mockup on first run. The exact values are in the mockup's `<script>`: arrays `ACCOUNTS`, `TX` (23 transactions dated 1–28 Sep 2026), `CASH_HIST` (monthly totals Oct 2025 – Aug 2026) and `HOLD` (13 holdings).

- **Accounts:** Salary account, Savings account, Credit card, Cash. Pick opening balances and dates so the balances on 28 Sep 2026 equal the mockup: ₹2,18,450, ₹3,42,000, −₹18,640, ₹4,200.
- **Money history:** for Oct 2025 – Aug 2026, generate realistic monthly transactions (salary, rent, groceries, dining, bills, occasional larger spends) whose monthly income and spending totals match `CASH_HIST`. Use a seeded random generator so the output is the same every run.
- **Investments:** for each `HOLD` entry, create an asset and generate buys whose final units and total cost equal the mockup values:
  - Monthly SIPs for mutual funds, starting between Jan 2023 and 2025.
  - 2–4 lump-sum buys for stocks, ETFs and gold.
  - A single deposit for the FD (with rate and start date).
  - Yearly deposits and valuations for PPF.
  - Generate month-end prices with a gentle seeded random walk that ends at the mockup's latest prices (25 Sep 2026 for mutual funds, 28 Sep 2026 for the others). Add one earlier price per holding so "since last update" has values.
  - Link SIP buys to the Salary account.
- Set `settings.sample_data = true`.
- The generated data may differ slightly from the mockup's hard-coded figures. The goal is that it looks and feels the same.

All names are invented: "Meridian", "Banyan", "Saffron", "Harbor" funds, "Kaveri Power", "Sahyadri Foods", "Deccan Bank", "Fresh Basket" and so on. Do not replace them with real companies or with the owner's real holdings.

---

## 9. Commands and local setup

| Command | Does |
|---|---|
| `npm run dev` | `next dev -H 127.0.0.1 -p 3000` |
| `npm run build` / `npm start` | Production build; `next start -H 127.0.0.1 -p 3000` (faster for daily use) |
| `npm run db:generate` | `drizzle-kit generate` after schema changes |
| `npm run db:migrate` | Apply migrations (the app also applies pending migrations on start, after making a backup) |
| `npm run seed` | Load sample data into an empty database |
| `npm run reset -- --yes` | Wipe all data and recreate default categories |
| `npm run backup` | `VACUUM INTO data/backups/finance-YYYYMMDD-HHmm.db` |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |

Privacy and local-only defaults:

- Always bind to `127.0.0.1`, never `0.0.0.0`, so other devices on the network can't reach the app.
- Disable Next.js telemetry: add `NEXT_TELEMETRY_DISABLED=1` to `.env` and document `npx next telemetry disable` in the README.
- `.gitignore` must include `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `.env*`.
- The only network use is `npm install` and the build-time font download. The running app makes no external requests.
- The database path comes from `DATABASE_PATH` (default `./data/finance.db`). Create the folder if it's missing.

Write a `README.md` covering install, first run, daily use (`build` + `start`), backup and restore, and the privacy notes above.

---

## 10. Conventions (copy the essentials into CLAUDE.md)

- TypeScript strict. No `any`, no `@ts-ignore` without a comment explaining why.
- Money is integer paise in all code. Use a `Paise` type alias and convert only at input parsing and display. Units, prices and rates are decimal strings and are calculated with `decimal.js`.
- Dates are `YYYY-MM-DD` strings. Use the helpers in `lib/domain/dates.ts`; never create a `Date` for date-only values without them (avoids timezone shifts).
- Only `lib/queries` and `lib/actions` touch the database. Components never import `lib/db`.
- Every server action validates with Zod, runs writes in a transaction, revalidates affected paths and returns the standard result shape.
- Components live in their own folder with a CSS Module. Use CSS variables from `tokens.css` only; no raw hex colours in components.
- Every function in `lib/domain` has unit tests, including edge cases (zero units, sell everything, split, missing prices, leap years).
- Follow the copy rules in section 2.4.
- Add a dependency only when it clearly earns its place, and mention why in the phase summary. Approved: next, react, react-dom, typescript, drizzle-orm, drizzle-kit, better-sqlite3, zod, decimal.js, vitest, eslint, prettier, server-only, and a zip library for the full export.
- Never commit anything in `data/`. Never use real personal financial data anywhere in the repo.
- Keep `docs/PLAN.md`'s Progress log current.

---

## 11. Phases

Each phase ends with the acceptance checks passing (`npm run lint`, `npm run typecheck`, `npm test`, plus the listed manual checks) and a short summary for the owner, including anything that deviated from this plan.

### Phase 1 — Foundation

- Initialise git and the Next.js + TypeScript project. Move `PLAN.md` and the mockup into `docs/`. Create `CLAUDE.md`, `.gitignore`, `.env.example` and `README.md`.
- Port the mockup's tokens and base styles into `styles/`. Set up the three fonts with `next/font`, including the Fraunces `SOFT` axis.
- Build the app shell: TopBar with nav and the "Sample data" pill, PageHead, StatStrip, Tabs, SubTabs.
- Build all shared components from section 2.3, including the three charts. Show them on `/dev/ui` with sample props, in light and dark.
- Database: schema, first migration, connection with pragmas and auto-migrate (backup first), default categories, `seed`, `reset` and `backup` scripts.
- Domain groundwork: `format.ts`, `money.ts`, `dates.ts` with tests.
- Every route exists and renders its PageHead with a placeholder body.

*Done when:*

- `npm run dev` serves the app at 127.0.0.1:3000 and navigation works.
- `/dev/ui` matches the mockup's building blocks side by side.
- `npm run seed` fills the database, and `npm run reset -- --yes` empties it.
- All tests pass.

### Phase 2 — Money

- Accounts tab and Categories tab, with create, edit and archive.
- Transactions tab: filter bar synced to the URL, sorting, search, totals row, "Show more", empty state, CSV export.
- Transaction drawer: add, edit, duplicate, delete with Undo toast, and validation messages.
- Money strip. Balances in `balances.ts`, with tests.

*Done when:*

- With sample data, the Money page matches the mockup.
- The owner can enter a month of real transactions and the balances match their bank.
- Transfers never change income or spending totals.

### Phase 3 — Budgets

- Budgets tab: inline editing, carry-forward, "Copy last month's budgets", over-budget states.
- Tests for `budgets.ts`, including carry-forward and "0 means no budget".

*Done when:* the budget figures on the Budgets tab and the Dashboard's budget card agree for any month.

### Phase 4 — Investments

- Assets: create, edit, archive; the "New investment…" flow.
- Investment transaction drawer: every action, "Paid from" / "Received in" linking, live total, oversell check.
- Prices and valuations: the Update prices drawer, and the single-price action on each row.
- `holdings.ts`, `valuation.ts` (including FD maths) and `xirr.ts`, with the test vectors from section 6.
- Overview tab: groups, sub-tabs, totals, sold toggle, CSV.
- Investments → Transactions tab, including balance units.
- Holding detail page.
- Linked money transactions shown correctly on the Money side.

*Done when:*

- The seeded portfolio's figures match a hand-checked spreadsheet (include it as `tests/fixtures/portfolio-check.csv`, built from invented data).
- Deleting a linked transaction on either side removes both.
- XIRR tests pass.

### Phase 5 — Dashboard and Performance

- Connect every Dashboard card to real queries, including the month picker.
- `performance.ts` with tests. Performance tab: filter bar, aggregate card, graph, group tables.
- Gainers/losers and allocation queries.

*Done when:*

- Every Dashboard figure matches the equivalent figure on the Money or Investments pages for the same month.
- Charts render correctly with 0, 1 and many data points.

### Phase 6 — Reports, Settings and polish

- Reports page (financial year and calendar year).
- Settings: backup, restore (with validation), full export, remove sample data, preferences.
- Empty states on every page for a brand-new database (no accounts, no transactions, no investments) that guide the owner to the first action.
- Keyboard and screen-reader pass; responsive pass at 360px, 768px and 1440px; dark-mode pass.
- Optional Playwright smoke test: add a transaction, see it on the Dashboard.

*Done when:*

- Backup → reset → restore brings everything back exactly.
- A fresh database leads the owner from an empty app to a first account, a first transaction and a first investment without confusion.

### Phase 7 — Import from Value Research

- `/investments/import`: choose the Transaction History `.xls` that Value Research downloads, check it, then import. Checking changes nothing.
- `lib/xls.ts` reads Excel 97–2003 files (BIFF8 in an OLE container) without a dependency. `lib/domain/valueResearch.ts` turns both sheets (Mutual Funds & SIFs, Stocks & ETFs) into buys and sales: dates `DD-Mon-YY`, sells negative, charges = amount − units × price (stamp duty, brokerage). A price that would make the charges negative is worked out from the amount instead, so money moved always equals the file. Other transaction types are listed as not imported.
- The sheet's Total row must equal the sum of its rows.
- Each fund or stock is matched by ISIN (stored as the asset's symbol). An unmatched one becomes a new investment, or the owner maps it to an existing one; same-name investments without an ISIN are suggested. Asset class is guessed from the name and can be changed.
- Rows already in Hisaab (same investment, date, action and units) are skipped, so the same All-time file can be imported again safely. A sale larger than the units held blocks the import.
- Optional: one account to record the buys and sales in Money as linked transfers.
- A `-pre-import` backup is saved first; everything is written in one transaction.

*Done when:*

- A real download imports with net invested equal to the file's totals, and importing it again adds nothing.

---

## 12. Testing checklist (minimum)

- **format:** Indian grouping, Lakh/Crore thresholds, negative and zero signs, `0.00%` not `−0.00%`.
- **money:** parsing "1,250.50", "₹ 1250", "1250.555" (reject more than 2 decimals), and empty input.
- **dates:** month boundaries, leap years, financial-year boundaries (31 Mar / 1 Apr).
- **balances:** income, spending, transfers in and out, opening date cut-off, credit card sign.
- **budgets:** carry-forward, amount 0, category without a budget.
- **holdings:** the section 6 vector; sell everything; split; bonus at price 0; oversell rejected; fees.
- **valuation:** latest price on or before a date; missing price falls back to the buy price; FD vector; simple interest; maturity cap.
- **xirr:** both section 6 vectors; all-negative flows return `null`; under-365-days produces "abs.".
- **performance:** month-end points, missing prices carried forward.
- **linked transactions:** create, edit and delete keep both sides in sync.

---

## 13. Decisions (settled)

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript (Next.js) | Owner uses Claude Code; one language across the stack |
| Hosting | Local only, 127.0.0.1, single user, no login | Personal data stays on the owner's machine |
| Styling | Port mockup CSS; no Tailwind | The design already exists as CSS |
| Charts | Custom SVG; no chart library | Matches the design exactly |
| Spending colour | Neutral text with −, not red | Red is reserved for losses and overspending |
| Dark mode | Follows system setting | Already designed in the mockup |
| Daily change | "Since last update" instead of "1 day" | Prices are entered by hand, not daily |
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
- Automatic prices, e.g. importing mutual fund NAVs from a downloaded file. Any online source would need the owner's approval and a check of its terms of use.
- Benchmark comparison (e.g. against an index) and inflation-adjusted returns.
- Tax view: capital gains by financial year using FIFO. This is not tax advice.
- Rule-based insights card ("Dining is 30% above your 3-month average").
- Split transactions across categories, attachments/receipts, multiple currencies.

---

## 15. Progress log

Update this as work happens: one line per phase with the date, status and notes.

| Phase | Status | Date | Notes |
|---|---|---|---|
| Planning and mockup | Done | Sep 2026 | Mockup approved by owner |
| 1 — Foundation | Done | 28 Sep 2026 | Shell, all shared components on `/dev/ui`, schema + migration, seed/reset/backup, domain helpers with 35 tests. Drawer uses native `<dialog>`, Menu uses the popover API. `/dev/ui` not compared in a browser — no preview pane on this install. |
| 2 — Money | Done | 29 Sep 2026 | Transactions, Accounts and Categories tabs, transaction drawer, Money strip, CSV export; `balances.ts` + validation tests (55 total). Checked in a browser against the seed: strip and September totals match the mockup, transfers excluded. Undo keeps deleted rows in memory for 60 s (lost on restart). Accounts and categories can be deleted only while unused; otherwise archive. Fixed Phase 1 CSS: table alignment, filter spans, page padding. Real-bank balance check is the owner's. |
| 3 — Budgets | Done | 29 Sep 2026 | Budgets tab with month picker, inline editing (blur/Enter saves, Escape reverts), "Without a budget" list with Set budget, totals row, over-budget states, copy last month with Undo. Budgets, the Money strip and (from Phase 5) the Dashboard card all read `monthBudgets()`, so they agree. "Copy last month's budgets" removes this month's own changes, since budgets carry forward. A value equal to what carries in stores no row. Undo store moved to `lib/undo.ts`. 64 tests. |
| 4 — Investments | Done | 29 Sep 2026 | Overview (groups, sub-tabs, totals, sold toggle, CSV), Investments → Transactions (filters, balance units, CSV), holding detail page (invested-vs-worth chart, FD deposit details), investment drawer with every action, "Paid from"/"Received in" linking, live total, oversell check and inline "New investment…", one Update prices drawer for prices and values, asset edit/archive (archive only once sold). `holdings.ts`, `valuation.ts`, `xirr.ts`, `portfolio.ts` with tests; `tests/portfolio-check.test.ts` seeds a temp DB and matches `tests/fixtures/portfolio-check.csv`. Linked delete checked in the browser from both sides. Manual-asset value = last statement ± later deposits/withdrawals; a withdrawal beyond cost counts as realised gain. Seed fix: SIP prices are scaled so the last buy no longer takes an odd price, and SIP amounts are exact. `FilterForm` pulled out of `TransactionFilters`; `PageHead` gained `sub`. No holdings column sorting yet. 122 tests. |
| 5 — Dashboard and Performance | Done | 29 Sep 2026 | Dashboard on real queries with a month picker (past months show balances and holdings at month-end; future or invalid months fall back to this month): strip, income vs spending, where money went, portfolio performance, allocation, budgets, recent transactions, returns by type, top gainers & losers, accounts. Performance tab: as-of date and period filter, returns card with XIRR, invested-vs-worth chart, one table per investment type with totals, CSV export. `performance.ts` with 16 tests (138 total). Checked in a browser: September and August figures match the Money, Budgets and Investments pages; charts render with 0, 1 and many points (single points now draw dots); 360px layout. Performance adds a "Financial year to date" period; the Dashboard's YTD chip uses the calendar year, as in the mockup. "Since last update" covers holdings with two or more prices. |
| 6 — Reports, Settings and polish | Done | 30 Sep 2026 | Reports: financial or calendar year, strip (income, spent, saved with savings rate, net invested), monthly income vs spending chart, spending and income by category × month tables with totals, CSV. Settings: Back up now (saved to `data/backups/` and downloaded), restore with validation (SQLite header, integrity check, Hisaab tables, not from a newer version, migrated, foreign keys) after a `-pre-restore` backup, full CSV export as a zip (hand-written with `node:zlib`, no new dependency), start fresh (type DELETE, `-pre-reset` backup), preferences (FY start month, default FD compounding, now used by the investment drawer), About (paths, size, backup count, version). Empty states: Dashboard "Get started" card with three steps that tick off; the transaction drawer sends a new owner to add an account first. Passes: accessibility audit of 12 page variants (names, labels, ids, headings), mobile button labels now visually hidden instead of removed; 360/768/1440 and dark mode checked in a browser. `tests/backup.test.ts` proves seed → backup → reset → restore gives identical tables; zip round-trip test. Playwright skipped (would add a dependency). Placeholder component removed. 145 tests. |
| 7 — Import from Value Research | Done | 30 Sep 2026 | `/investments/import` with check-then-import, entry points on Investments (head and empty state) and Settings. Hand-written `.xls` reader (`lib/xls.ts`, no dependency; SheetJS on npm is stale and not approved), `valueResearch.ts` parser, `planImport` (ISIN match, same-name suggestion, count-based duplicate check, oversell check) and `applyImport` (one transaction, `-pre-import` backup, prices from real NAVs only, optional linked Money transfers). `linkedFields` moved to `holdings.ts` as `linkedMoneyRow`. Tests build `.xls` fixtures in memory from invented data (`tests/helpers/xlsWriter.ts`). Parser checked against the owner's real download locally (not committed): 103 rows, 34 ISINs, totals match, one sale gets a worked-out price. Browser check with the real file still to do. Dividends, switches and bonus rows in future files are listed as not imported. |
