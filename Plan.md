# Planning Process — Expenditure Tracker

This documents how the app was planned and built, for anyone picking up the project later.

## Starting point

The `Expenditure Tracker/` folder existed as a sibling to the `ToDo/` app inside the `CC_Workspace` git repo, containing only a one-line, unfinished `specs.md` stub ("Plan for a Expenditure tracker app / Specifications / 1. Do "). The request was: an app to log expenses (amount, date, category, payment method, optional receipt), a dashboard (monthly totals, category breakdown chart, budget-vs-actual per category), date-range/category filters, and CSV export.

## Decisions made up front

Three open questions were resolved with the user before design started, since they shaped everything downstream:

1. **Tech stack** — plain HTML/CSS/JS, no framework, no build step, must run from `file://`. (Alternative considered: React + Vite, rejected to stay consistent with the sibling `ToDo` app and avoid npm tooling.)
2. **Storage** — browser `localStorage` only, no backend/server/database. (Alternative: a small Node server + SQLite, rejected as unnecessary complexity for a single-user local app.)
3. **Charts** — hand-drawn inline SVG, no CDN chart library, no external network requests. (Alternative: Chart.js from a CDN, rejected to keep a strict, ToDo-style CSP with no external dependencies.)

## Design approach

Rather than design from scratch, the plan deliberately mirrored the actual, verified patterns already working in the sibling `ToDo/` app (module-level state, a `render()` that rebuilds the whole list from scratch, an `update()` = save+render helper, checksum-guarded `localStorage`, an undo-toast for destructive actions, transient in-place DOM editing, and the theming/mobile-reflow CSS techniques) — read directly from `ToDo/app.js`, `ToDo/index.html` and `ToDo/style.css` rather than assumed, and cited by line number in the plan so the resulting code would actually match.

For the two dashboard charts, the `dataviz` skill's guidance was applied rather than an ad-hoc choice:
- **Category breakdown** uses a horizontal bar chart, not a donut/pie — the skill explicitly prefers bars for comparing values, and a self-labeling row (swatch + name + amount + %) avoids needing a separate legend.
- **Budget vs. actual** uses a meter per category (the standard form for "a ratio against a limit"), not the same bar-chart component reused — with color escalating from the category's own color to amber (≥80% of budget) to red (over budget), since color alone should never be the only signal.
- Category colors come from the skill's CVD-validated 8-color categorical palette; categories beyond the 8th share one muted "Other" bucket in the charts rather than a 9th, less-distinguishable color.

## Architecture

- **File split**: `storage.js` (constants, data schema, load/save, checksum, migration), `charts.js` (pure SVG-drawing functions), `app.js` (state, DOM wiring, event handlers) — loaded as three plain `<script src>` tags, in that order. ES modules were ruled out because `type="module"` fails silently under `file://` in Chromium; classic scripts still share one global scope, preserving the "flat module-level state" style of the original single-file `ToDo/app.js`.
- **Data model**: amounts stored as integer cents (avoids float drift); dates as `YYYY-MM-DD` strings; receipts stored as compressed base64 JPEG data URLs (capped at 1000px / ~400KB after compression) to protect the shared `localStorage` quota.
- **Two independent scopes**: the dashboard's month selector and the list's date-range/category filters are deliberately separate pieces of state, so filtering the list to one category doesn't produce a misleading dashboard.

Full detail — file layout, storage schema, compute functions, CSV format, receipt pipeline, editing/undo flow, theming — is in `specs.md`, which reflects the app as actually built.

## Implementation and verification

After writing the five files, the app was launched in a real (headless) browser and driven programmatically — filling in the add-expense form, submitting it, setting a category budget, reading back the dashboard's computed values, exporting CSV, deleting and undoing an expense, and screenshotting both the desktop and mobile (375px) layouts — rather than only reviewing the code by eye.

This caught two real bugs before hand-off:
1. The receipt image preview box was visible on page load when it should have been hidden — a CSS `display: flex` rule on `#receipt-preview` was silently overriding the element's `hidden` attribute. Fixed by adding an explicit `#receipt-preview[hidden] { display: none; }` rule (the same pattern `ToDo/style.css` already uses for its toast).
2. The inline edit-mode fields (amount, date, category, payment method, note, receipt) had no mobile `order` value, so on a phone they would have rendered in the wrong visual position relative to the rest of the row. Fixed by giving them distinct classes and `order` values matching their read-mode counterparts, then re-verified with a screenshot of the edit row at 375px width.

Not exercised by the automated pass (reviewed by code inspection only): actual receipt file upload/compression end-to-end, the light-mode theme toggle, and the add-category/currency forms.

## Phase 2: six follow-up features

After the initial build, the user asked for a prioritized set of improvement suggestions, then asked to implement the top six: full JSON backup/restore, category rename/delete, a 6-month spending trend chart, an at-add-time budget-exceeded warning, free-text search, and recurring (monthly) expense templates.

**Design choices worth recording:**
- Category rename/delete needed to cascade everywhere a category name is used as a foreign key (expenses, recurring templates, the budgets map, the active category filter) — `renameCategoryEverywhere()`/`deleteCategoryEverywhere()` in `app.js` centralize that, and deletion reassigns affected records to "Other" after a confirmation that states the affected count, following the same undo-snapshot pattern as expense deletion (extended to also snapshot `budgetsData`/`recurringData` when those are what's changing, not just `expenses`).
- `storage.js`'s `loadBudgets()`/`loadExpenses()` were refactored to route through new `sanitizeBudgetsData()`/`sanitizeExpensesList()`/`sanitizeRecurringList()` functions, so the JSON-backup restore path validates a foreign file exactly the same way normal `localStorage` loading does, rather than duplicating that logic.
- `nextColorSlot()` changed from "next index by count" to "first free slot 0-7" once category deletion existed, so a slot freed by deleting a category can be reused by a later one without colliding with a category that still exists.
- Recurring templates generate "catch-up" expenses (capped at 24 months) for any elapsed months since the template's start or last generation, both immediately on creation and once per app load — so the feature behaves reasonably whether the app is opened daily or after a long gap, without a background scheduler (there isn't one; a plain page has no way to run code while closed).
- The trend chart and category-breakdown chart intentionally use different chart forms (a time-series column chart vs. a value-comparison bar chart) for the same reason the original budget meters differ from the category bars: each is the dataviz skill's recommended form for that specific question, not a shared component reused across different jobs.

**Verification**: driven the same way as Phase 1 — a headless browser exercising the real DOM (form submissions, button clicks, confirm() stubbed to auto-accept) rather than unit-testing functions in isolation. This caught one real test-harness pitfall worth noting for next time: firing two `addForm` submissions back-to-back tripped the app's legitimate 500ms anti-double-submit throttle, which looked like a bug until traced back to the test script itself. No application bugs were found in this pass; all six features — including the exact budget-warning toast text, the cascading rename/delete, and the trend chart's per-month bars — were confirmed via both programmatic assertions and a visual screenshot.
