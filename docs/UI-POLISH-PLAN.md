# UI polish plan (Hallmark audit, 27 Oct 2026)

A working plan for fixing every finding from the Hallmark audit of 27 Oct 2026. When
it is done, add one line to [PLAN.md](PLAN.md) section 15 and delete this file; Git
history keeps the detail.

Depth: **polish**. Only what a finding names changes. No layout, route, component tree,
data shape or wiring changes. Every link, field, handler and URL parameter stays.

Baseline on 27 Oct 2026: `npm run typecheck` and `npm run lint` clean, `npm test`
36 files and 475 tests passing.

## Ground rules

- Never open `data/finance.db`; it holds the owner's real data. All UI checks use a
  temporary copy of the invented seed (the Sample data pill shows).
- One commit per task group below, with a plain message. Push `master` after each phase.
- Keep changes minimal. No new tests (owner's call, 27 Oct 2026): every phase ends with
  `npm run lint`, `npm run typecheck` and a visual check of the pages it touched; the
  existing `npm test` suite runs once in Phase 5, and only existing tests that assert on
  changed copy are updated.
- Labels moving away from tracked capitals changes the mockup look. The owner agreed to
  it on 27 Oct 2026; record it in PLAN section 2 (task 2.1).

## Phase 0: working on the Pi

**0.1 Sample-data dev server.** Create `/tmp/opencode/hisaab-dev/seed.db` with
`npm run db:migrate` and `npm run seed` under that `DATABASE_PATH`, then run
`npx next dev -H 127.0.0.1 -p 3123` with the same `DATABASE_PATH`. Confirm the
Sample data pill. Confirm `next dev` writes to `.next/dev` and leaves the live
service's `.next` build alone; if it does not, use a separate checkout for development.

**0.2 Baseline record.** Run, from the repo root (`.hallmark/` is git-ignored):

```
node ~/.agents/skills/hallmark/scripts/sloplint.mjs app components styles \
  --genre editorial --scope app --before --url http://127.0.0.1:3123/ ...
```

with one `--url` per route in PLAN section 7 (plus `/investments/2`). This saves the
before screenshots and the list of links, fields and handlers that the final check
compares against.

**0.3 Docs for the Pi.** Update [CLAUDE.md](../CLAUDE.md) "Where the app runs",
[HANDOFF.md](HANDOFF.md) and PLAN section 1 to describe the Pi:

- Checkout `/home/ujju/repos/hisab`, live service `hisaab.service` on `127.0.0.1:8080`,
  Tailscale Serve at `https://pi.tail276cc3.ts.net`, Node 26 from nvm.
- To ship: checks, commit, push, `npm run build` with `DATABASE_PATH` pointing at
  `data/finance.db`, `sudo systemctl restart hisaab.service`, check the URL.
- Keep the myvm notes only as history, or remove them once the owner retires the VM.

Done when: dev server on the seed is up, before record exists, docs name the Pi.

## Phase 1: things that look broken

**1.1 Import page: label covers the description.** The card's content starts right
under its subtitle, and the field label sits 7px above its box.
- Give Card content a gap below the head: add a top margin to the first child after
  `.head` in [Card.module.css](../components/Card/Card.module.css) (start at 16px).
- Check every Card user for doubled space, since some content already adds its own
  top margin: Dashboard cards, Settings rows, Investment detail, ReturnsCard, the
  import page. Remove the local margin wherever the new gap doubles it.
- Check: `/investments/import` at 375 and 1440, nothing overlaps; other cards keep
  the same spacing as the before screenshots.

**1.2 Cards touching on Investments.** `.page-body` stacks its children without any
gap on two pages.
- [app/investments/(tabs)/page.tsx](../app/investments/(tabs)/page.tsx) line 361 and
  [app/investments/[assetId]/page.tsx](../app/investments/[assetId]/page.tsx) line 117:
  add the `stack` class to the `wrap page-body` div, as Budgets and Categories do.
- Check `.tbl-note` and the filter rows don't gain double margins inside `.stack`
  (Categories uses `style={{ margin: 0 }}` for this; prefer a class).
- Check: 28px between the Performance card and Mutual funds, and between the chart
  card and Transactions on an investment page.

**1.3 Table headers say things twice.** In the investments columns, the first sort
option's small label repeats the second option's name ("Total cost *Cost per unit*"
above "Cost per unit").
- [app/investments/(tabs)/page.tsx](../app/investments/(tabs)/page.tsx) lines 113–215:
  drop `sub` from the first option of each two-option column (change, cost, value,
  return), or keep a sub only when it says something new (the period label "1 day"
  on Change in period does; keep that one).
- Check the same pattern elsewhere: Money transactions "Description *Note*", investment
  transactions "Amount *Fees*" over "Fees", Categories "Transactions *2026–27*". Keep a
  sub that adds a fact; drop one that repeats the line below.
- Check: each header reads once; sorting by either line still works.

**1.4 Dangling dots in the returns summary.** On phones the range lines in
[ReturnChart.tsx](../components/charts/ReturnChart.tsx) lines 215–240 end with "·".
Fixed by task 2.3 (the separators go); check this view at 360px after that task.

Commit: "Fix import label overlap, investments card gaps and repeated table headers".

## Phase 2: Floor findings

**2.1 Labels in sentence case.** Remove `text-transform: uppercase` and letter-spacing
from small labels, keeping size and weight; text already written in sentence case in
the source needs no copy change.
- Rules: `StatStrip .label`, `Field .label`, `Chips` buttons and links, `Tabs .view a`,
  `SubTabs .inner a`, `Tag .tag`, `InvestmentDrawer .section`,
  `CategoriesTables .colors legend`, `SmsDevices .codeLabel`, `SmsReview .overrides
  legend`, `SmsReview .table th`, `SmsReview .missing h4`, `SmsReviewForm .flowLabel`,
  `SmsMessage .originalHead h4`, `app/money/page.module.css` line 84 (the restacked
  money-table cell labels).
- Find each label's source text and make sure it reads as sentence case ("By asset",
  "All time", "Mutual funds"). Short codes stay as written (YTD, 1M, 1Y, FY).
- Tabs: with capitals gone, `Tabs .view` and `SubTabs` should look like one family with
  the page tabs (same face and size, a step smaller). Review the divider pipes between
  items; drop them if spacing alone separates the items.
- Mockup: note in PLAN section 2 that labels are sentence case and untracked, a
  deliberate change from `docs/mockup.html`.
- Check: Dashboard, Money (all tabs), SMS views, Investments, Settings, both themes;
  no label wraps or truncates at 360px.

**2.2 Dashes back in copy.** Follow the 26 Oct pattern (`cef8d02`): an empty value is
blank (`null` or `undefined`), not "—".
- [InvestmentTxnTable.tsx](../components/InvestmentTxnTable/InvestmentTxnTable.tsx) line 17
  (`MUTED`), [InvestmentChange.tsx](../components/StatStrip/InvestmentChange.tsx) line 24,
  [app/investments/[assetId]/page.tsx](../app/investments/[assetId]/page.tsx) lines 150,
  155, 173 (FD details: "Not set" reads better than blank in a details list),
  [ReturnChart.tsx](../components/charts/ReturnChart.tsx) lines 191, 197, 204 (tooltip
  and summary: "No data" rather than blank, so the line isn't empty).
- `app/dev/ui/Showcase.tsx` lines 186–187 too, so `/dev/ui` shows the real pattern.
- Check: `grep -rn "—" app components --include=*.tsx` finds nothing in shown copy.

**2.3 Middle-dot separators.** Replace with spacing, commas or parentheses, matching
copy already used elsewhere in the app:
- Figures with a percentage use parentheses, as "Returns by investment type" already
  does: [GainLoseTiles.tsx](../components/GainLoseTiles/GainLoseTiles.tsx) line 26
  ("+₹2,183 (+1.12%)"), [Donut.tsx](../components/charts/Donut.tsx) line 72
  ("₹15,17,403 (69.9%)").
- Sentences become sentences: [app/page.tsx](../app/page.tsx) line 453 ("Accounts and
  investments. YTD starts on 1 January."), [ReturnsCard.tsx](../components/ReturnsCard/ReturnsCard.tsx)
  line 61, [SmsReviewForm.tsx](../components/SmsReviewForm/SmsReviewForm.tsx) line 223
  ("go to {account} under {category}").
- Lists become comma lists: [app/investments/[assetId]/page.tsx](../app/investments/[assetId]/page.tsx)
  line 86, [app/investments/(tabs)/page.tsx](../app/investments/(tabs)/page.tsx)
  lines 103–105 ("24.87 on 25 Sep 2026", "24.87, price not updated"),
  [app/money/sms/page.tsx](../app/money/sms/page.tsx) line 144,
  [app/settings/page.tsx](../app/settings/page.tsx) line 146,
  [ImportForm.tsx](../components/ImportForm/ImportForm.tsx) lines 115 and 155.
- [app/page.tsx](../app/page.tsx) line 286: "Not added · Add" becomes the link alone,
  "Add NPS", in the value column.
- Summary rows use a flex gap instead of dot spans:
  [ReturnChart.tsx](../components/charts/ReturnChart.tsx) lines 220–240 (also fixes 1.4).
- Meta rows drawn with CSS `::before` dots use `column-gap` instead:
  `SmsMessage.module.css` lines 49–50, `SmsReview.module.css` lines 79–80 and 170–171,
  `SmsDevices.module.css` lines 66–67. Remove the `margin-inline` that went with them.
- Keyboard hint, [SmsReview.tsx](../components/SmsReview/SmsReview.tsx) line 433: show
  each key and action as its own item (`<kbd>J</kbd>/<kbd>K</kbd> move`, …) in a
  wrapping row with a gap, keeping `aria-hidden` and the "?" pointer to the full list.
- Existing tests that assert on these strings (search `tests/` for " · ") move with them.
- Check: `grep -rn "·" app components` finds no separators; wrapped lines at 360px
  never start or end with punctuation.

**2.4 Form states.**
- [Field.module.css](../components/Field/Field.module.css) line 60: focus shows as an
  `outline: 2px solid var(--primary)` with a small offset on `.field:focus-within`,
  appearing instantly; the border colour and width stay the same in every state.
  The invalid state keeps its red border.
- [SmsReviewForm.module.css](../components/SmsReviewForm/SmsReviewForm.module.css)
  line 138: a disabled fieldset adds `cursor: not-allowed` and muted text alongside the
  opacity; the `disabled` attribute already comes from the fieldset.
- Check: tab through Money filters, the transaction drawer and an SMS review form in
  both themes; the focus ring clears 3:1 against the card and the page.

Commits: one each for 2.1, 2.2 with 2.3, and 2.4.

## Phase 3: tidying

**3.1 Period dropdown.** `StatStrip .periodSelect` keeps the browser's default look.
Give it the same `appearance: none`, chevron and edge as Field selects, at the stat
strip's compact size. Check Dashboard, Investments and an investment page; on a phone
the Dashboard "−₹13,856 over 1 day" line should not split "over" from its control.

**3.2 "No ISIN" is not a failure.**
- [lib/actions/prices.ts](../lib/actions/prices.ts) lines 52–58: when nothing is
  eligible, save the status as ok with 0 updated and a plain message, so the Dashboard
  no longer says "did not finish" and offers "Try again".
- [app/investments/(tabs)/layout.tsx](../app/investments/(tabs)/layout.tsx) line 34:
  hide "Update now" when no investment has an ISIN; say how to fix it instead ("Add an
  ISIN under Symbol or code to fetch prices.").
- Same message in Settings → Update prices now.

**3.3 Blank where there is nothing to show.**
- Performance: drop the "% p.a." column when every row in the table has no annual
  return ([performance/page.tsx](../app/investments/(tabs)/performance/page.tsx) line 90);
  the footnote already says why.
- Reports: months after the current one show blank instead of 0 in both category
  tables and their totals ([app/reports/page.tsx](../app/reports/page.tsx) lines 53–60
  and 83–86). Past months with nothing spent keep their 0.

**3.4 SMS page buttons.** With no phone paired and nothing to review, the page shows
"Pair a phone" twice. Keep the one in the empty state and hide the header button in
that state ([SmsPairing.tsx](../components/SmsPairing/SmsPairing.tsx) line 80 and
[app/money/sms/page.tsx](../app/money/sms/page.tsx) line 66). Check that both states
(paired and not) still have one way to pair.

Commit per task.

## Phase 4: spacing scale

138 padding, margin and gap values sit off the 4px scale (sloplint gate 24b), listed in
the before record.
- Work one component module at a time. Round each value to the nearest multiple of 4
  where the rendered change is 2px or less (7 to 8, 10 to 12 or 8, 14 to 16 or 12,
  15 to 16, 22 to 24, 26 to 24, 30 to 32).
- Keep deliberate optical values (1–3px nudges against a border, the segmented control's
  3px inset, padding that matches a field's height) and record each kept set with one
  waiver line at the top of that module, as `DataTable.module.css` already does:
  `/* Hallmark · waive 24b · <what stays> · <why, in this component's words> */`.
- Compare before and after screenshots per page; no control may change height.

Commit per few modules: "Spacing on the 4px scale: <components>".

## Phase 5: verify and ship

1. `npm run lint`, `npm run typecheck`, `npm test`.
2. Re-run sloplint with `--kept` against the Phase 0 record:
   `node ~/.agents/skills/hallmark/scripts/sloplint.mjs app components styles --genre
   editorial --scope app --kept --url …`. Target: 0 FAIL, every REFLEX fixed or waived,
   nothing lost from the kept record (links, fields, handlers). Open
   `.hallmark/compare.html` for the side-by-side.
3. Dismiss the audit's false positives on the record in `styles/globals.css`: 33
   (`Icon.tsx` passes `aria-hidden`), 34 (`overflow-x: clip` is on `html` and `body`),
   80 (the allocation donut is a labelled chart).
4. Update the check stamp at the top of `styles/globals.css` with the date and counts.
5. Manual checks from PLAN section 12: 360/768/1440px, both themes, keyboard focus,
   drawers, empty and populated states.
6. Add one line to PLAN section 15, delete this file, commit, push.
7. Deploy: `npm run build` with `DATABASE_PATH=/home/ujju/repos/hisab/data/finance.db`
   (it backs up and migrates), `sudo systemctl restart hisaab.service`, open
   `https://pi.tail276cc3.ts.net` and check it loads.

## Task list

| # | Task | Phase | Files |
|---|---|---|---|
| 0.1 | Sample-data dev server | 0 | none |
| 0.2 | Hallmark before record | 0 | `.hallmark/` (ignored) |
| 0.3 | Docs describe the Pi | 0 | CLAUDE.md, docs/HANDOFF.md, docs/PLAN.md |
| 1.1 | Card content gap; import label overlap | 1 | Card, Card users |
| 1.2 | Investments card gaps | 1 | investments page, investment page |
| 1.3 | Repeated table header labels | 1 | investments columns, other DataTable users |
| 1.4 | Dangling dots in returns summary | 1 | via 2.3 |
| 2.1 | Labels in sentence case | 2 | 15 CSS rules, label copy, PLAN section 2 |
| 2.2 | Remove leftover dashes | 2 | 5 files |
| 2.3 | Replace middle-dot separators | 2 | 12 TSX, 3 CSS modules |
| 2.4 | Field focus ring, disabled fieldset | 2 | Field, SmsReviewForm |
| 3.1 | Period dropdown matches other selects | 3 | StatStrip |
| 3.2 | "No ISIN" isn't a failure | 3 | prices action, investments layout, Settings |
| 3.3 | Blank empty columns and future months | 3 | performance page, reports page |
| 3.4 | One "Pair a phone" button | 3 | SmsPairing, SMS page |
| 4 | Spacing on the 4px scale | 4 | about 30 CSS modules |
| 5 | Verify, log and deploy | 5 | globals.css stamp, PLAN section 15 |
