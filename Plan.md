# Planning Process — Expenditure Tracker

This documents how the app was planned and built, for anyone picking up the project later.

## Maintenance: updating the vendored pdf.js

`pdf.min.js`/`pdf.worker.min.js` are a one-time download (currently pdf.js 6.3.289) converted to classic-script form — see the "The `file://` module wall" section under Phase 3 below for exactly what that conversion does and why. There is no automatic update mechanism, and since the app now runs untrusted, user-uploaded PDFs through this parser, it's worth periodically checking https://github.com/mozilla/pdf.js/security/advisories (or just the releases page) for fixes, and re-vendoring when one ships:
1. Download the new version's `legacy-dist.zip` from the GitHub release assets and extract `build/pdf.mjs` and `build/pdf.worker.mjs`.
2. Re-run the same conversion: replace `import.meta.url` occurrences with `""` (only appears in dead Node.js-only code paths), rewrite the trailing `export { ... };` in `pdf.mjs` to `window.pdfjsLib = { ... };`, drop the trailing export in `pdf.worker.mjs` entirely (it already assigns `globalThis.pdfjsWorker = { WorkerMessageHandler }` itself), then wrap the converted `pdf.mjs` content in `(function () { ... })();` to keep its internals from colliding with the app's own global scope (this is what caught the `SVG_NS` collision with `charts.js` during initial vendoring).
3. Test exactly as described in Phase 3's verification section before replacing the committed files.

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

## Phase 3: bank statement PDF import

The user shared a real DBS bank statement PDF and asked for a feature to import it, auto-categorizing expenses. This phase is worth documenting in detail because it hit a genuine platform wall partway through, not just an implementation bug, and the eventual design only makes sense in light of that.

**The scope decision.** Two questions were resolved with the user up front: import via actual PDF upload (not paste-text/CSV, the lower-effort alternative offered), and show every parsed transaction — deposits included — in a review screen rather than silently filtering to withdrawals, with likely self-transfers (PayLah top-ups, inter-account transfers) pre-unchecked as a safety default.

**Why this needed a real dependency.** Everything else in this app is hand-rolled specifically to avoid dependencies, but parsing PDF binary structure from scratch is not a reasonable ask — the app vendors [pdf.js](https://mozilla.github.io/pdf.js/) (`pdf.min.js`, `pdf.worker.min.js`), downloaded once from its official GitHub release and committed to the repo, rather than loaded from a CDN, keeping the CSP's "no external resources" guarantee intact.

**The `file://` module wall.** Modern pdf.js ships only as ES modules. The app's architecture had already ruled out ES modules for its own scripts because `type="module"` fails under `file://` (empirically confirmed early in Phase 1). Testing directly confirmed the same failure for pdf.js: a nested `import` from one local file to another is blocked by Chromium with `origin 'null' ... blocked by CORS policy`, even for two files in the same folder. Since pdf.js's own bundle has no *internal* imports (it's a single self-contained file), its trailing `export {...}` statement was mechanically rewritten to a global assignment (`window.pdfjsLib = {...}`), and a couple of `import.meta.url` references — both inside dead Node.js-only code paths — were neutralized, making it loadable as a plain classic `<script src>`. Doing this then surfaced a second issue: pdf.js declares its own top-level `const SVG_NS`, colliding with `charts.js`'s identically-named constant, since classic scripts sharing a document share one global scope. The fix was to wrap the whole vendored file in an IIFE, giving it a private scope rather than chasing individual name collisions one at a time.

**The Worker wall — an unfixable one.** This version of pdf.js hard-requires a Web Worker; there is no main-thread fallback. Testing proved, conclusively, that **Web Workers cannot be constructed at all under `file://`** in Chromium, independent of module vs. classic script type (`new Worker(...)` throws `Script ... cannot be accessed from origin 'null'` even for a trivial worker with no imports). This is a hard browser security boundary, not something fixable by converting file formats — unlike the module issue above. Since the app had just been deployed to Vercel, the user confirmed that working only over http/https (not `file://`) was an acceptable trade-off for this one feature. The import panel now detects `location.protocol === "file:"` at load and disables itself with an explanatory message, rather than failing silently or half-working; every other feature in the app is unaffected and still works from a double-clicked local file.

**The parsing design.** A PDF's extracted text loses table structure — "withdrawal" vs. "deposit" is visually a column position, not something present in the flattened text. `statement-import.js` locates the statement's own column headers (DATE / DETAILS OF TRANSACTIONS / WITHDRAWAL($) / DEPOSIT($) / BALANCE($)) via `pdf.js`'s per-character position data, groups text items into visual lines by y-coordinate, and classifies each item into a column. This needed two different rules, discovered by testing against a synthetic statement PDF (rendered from HTML via headless Chrome print-to-PDF, built specifically to mirror the real layout) before trusting it near the user's actual bank data: DATE/DETAILS are left-aligned, so an item's *left* edge against header-midpoint boundaries works; WITHDRAWAL/DEPOSIT/BALANCE are narrow and right-aligned, so a short value's *left* edge can land well into the next column's zone — the fix compares the value's *right* edge against the raw (non-midpoint) start of the next column, since a right-aligned value's right edge sits just before where that next column begins. Transactions are assembled by watching for date lines and a fixed list of DBS transaction-type phrases; statement years are inferred by walking the transaction list backwards from the statement's "As at" date, decrementing the year whenever the month increases going backward (i.e., a Dec→Jan wrap going forward). Category and payment-method guesses come from keyword regexes against the transaction description, falling back to "Other" when nothing matches or the guessed category no longer exists.

**Verification.** Real DBS statements can't be used as a test fixture directly in this environment (no filesystem access to the user's uploaded PDF, and it's sensitive financial data besides), so a synthetic statement PDF with an identical table structure was generated and used for full end-to-end testing: a temporary local static HTTP server (a plain `System.Net.HttpListener` script, since Python/Node weren't available) stood in for "deployed over http/https", and a headless-browser test drove the real file input, read back the parsed review rows, clicked "Import selected", and confirmed both the resulting expense list and an Undo. This caught the right/left-edge column bug before it ever reached the user's real statement.
