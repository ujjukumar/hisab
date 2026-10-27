# Dashboard redesign plan (Hallmark, 27 Oct 2026)

A working plan for the agreed Dashboard redesign. When it is done, add one line to
[PLAN.md](PLAN.md) section 15, update section 7, and delete this file.

Depth: **full redesign, app screen**. The brand stays (tokens, IBM Plex Sans/Mono,
Fraunces titles, wordmark), and so does the shell. The owner's answers: open it a few
times a week on a laptop to see how wealth moved, what needs action, and whether the
month is on track. Drop the month picker; the page period defaults to 1 week. Remove
cards that don't serve those jobs. No new tests; existing tests run at the end.

## Phase A: data

- A1. `accounts.due_day` (nullable integer 1–31) with a migration; a "Bill due day"
  field for card accounts in the account drawer; validation and save action;
  `listAccounts` returns it.
- A2. `dailySpending(month)` in `lib/queries/money.ts`: spending per day of a month.
- A3. Attention: a card with money owed and a due day within 7 days gives a
  "Card bill due" item with the amount and date, carrying the account id for Pay.

## Phase B: the page

- B1. Page head: "Dashboard", today's date, period links 1D/1W/1M/3M/1Y (`?period=`,
  default 1w), Add transaction. Month picker and `?month=`/`?worth=` go.
- B2. Wealth band (8 columns): net worth, change over the period, the **net worth
  bridge** (start, market gains, money in and out, now; floating bars to scale), the
  net worth line for the same period, and "Moved most" (three up, three down).
- B3. Needs you rail (4 columns): the attention items as rows with one action each;
  card bills open a pre-filled transfer ("Pay"); "Nothing needs you right now" when empty.
- B4. This month (12 columns): spent of budget, left per day, earned, saved and rate;
  the spending pace chart (this month vs last month by day, budget line); the budgets
  closest to their limit (up to five).
- B5. Accounts and cards (with due dates and the net total) and Latest transactions
  (five rows), side by side.
- B6. States: Get started for a new app, no investments, no budgets, no cards, nothing
  needs you, a quiet period.
- B7. Leaves the page: Allocation, Returns by investment type, Income vs spending,
  Where your money went, the gainers and losers card, the summary strip. Components
  nothing else imports are deleted (file list checked first).

## Phase C: verify and ship

`npm run lint`, `npm run typecheck`, `npm test`; sloplint `--before` on `/` first and
`--kept` after, with removed links and figures recorded as dropped; screenshots at
1440 and 375 in both themes on the seed; PLAN sections 7 and 15; build, restart, check.
