# Expenditure Tracker — Specification

A single-page expense-tracking app in plain HTML, CSS and JavaScript (`index.html`, `style.css`, `storage.js`, `charts.js`, `app.js`). There is no package.json, build step, linter or test suite. To run it, open `index.html` in a browser (works from `file://`). To verify a change, exercise it by hand in the browser; use the DevTools device toolbar (Ctrl+Shift+M) for the mobile layout.

## Features

- **Log an expense**: amount, date, category, payment method (Cash, Debit Card, Credit Card, Bank Transfer, Other), an optional note, and an optional receipt image. If the category already has a budget and this expense pushes it over, a toast warns immediately ("Heads up: Groceries is now $X of its $Y budget for YYYY-MM").
- **Dashboard**, scoped to a selected month (independent of the list filters below):
  - Monthly total, with a percentage delta against the previous month.
  - A 6-month spending trend as a column chart, ending at the selected month (the selected month's bar is highlighted).
  - Category breakdown as a horizontal bar chart (with a "View as table" toggle for the same data).
  - Budget vs. actual per category, shown as meters. A category only appears here once it has a budget set. Meters turn amber at 80% of budget and red past 100%, with an "Nx over budget" label.
- **Filters and search**: date range (from/to), category, and a free-text search across note/category/payment method — all applied to the expense list. Sorting by newest/oldest or amount high/low.
- **CSV export**: exports the currently filtered/sorted/searched list (columns: Date, Category, Payment Method, Amount, Note, Has Receipt). Receipt images are never embedded in the CSV.
- **Full JSON backup/restore**: "Backup" downloads everything (expenses, categories, budgets, currency, recurring templates) as one JSON file; "Restore" replaces current data from such a file after confirmation, and is itself undoable via the toast.
- **Categories & budgets**: managed from a "Manage categories & budgets" panel — add, rename, or delete categories, and set a monthly budget per category. A currency code (e.g. USD, EUR) can also be set there. Renaming or deleting a category cascades to every expense and recurring template that referenced it (deletion reassigns them to "Other" after a confirmation showing the affected count); deletion is undoable via the toast.
- **Recurring expenses**: a "Recurring expenses" panel lets you define a monthly template (amount, category, payment method, day of month, optional note). On creation and on every app load, any months that have elapsed since the template's start (or since it was last generated) are caught up automatically, each producing one expense tagged with a small ↻ badge in the list. Templates can be paused (stops future generation without touching already-generated expenses) or deleted.
- **Import a bank statement**: an "Import bank statement" panel reads a PDF statement entirely client-side (via a self-hosted, vendored copy of [pdf.js](https://mozilla.github.io/pdf.js/), `pdf.min.js`/`pdf.worker.min.js`) and reconstructs its transaction table using text position data, since a PDF's flattened text loses column alignment. The parser is tuned for DBS-style statements specifically (column headers DATE / DETAILS OF TRANSACTIONS / WITHDRAWAL($) / DEPOSIT($) / BALANCE($)); other banks' layouts may not be recognized. Every row (withdrawals and deposits alike) is shown in a review table before anything is imported, with a guessed category, payment method, and checkbox; deposits and likely self-transfers (PayLah top-ups, inter-account transfers) start unchecked. Only checked rows are imported, as an undoable batch, on clicking "Import selected". **This feature requires the app to be served over http/https** — a real Web Worker (which pdf.js needs) cannot be created when the page is opened as a local `file://` document, a hard Chromium security restriction, not a bug; the panel detects this and disables itself with an explanatory message rather than failing silently.
- **Editing and deleting**: click the pencil on any expense row to edit its fields in place; delete is undoable via a 6-second toast.
- **Theming**: light/dark, following system preference by default, toggleable and remembered.

## Data model

An expense record:
```js
{
  id, amountCents, date /* YYYY-MM-DD */, category, paymentMethod,
  note, receipt: { dataUrl, type, width, height, sizeBytes, originalName } | null,
  createdAt, recurringId? /* present if auto-generated from a recurring template */
}
```

Budgets/settings record:
```js
{ categories: [{ name, colorSlot }], budgets: { [categoryName]: monthlyLimitCents }, currency }
```

A recurring template record:
```js
{
  id, amountCents, category, paymentMethod, note,
  frequency: "monthly", dayOfMonth /* 1-31, clamped to the actual last day of short months */,
  startDate /* YYYY-MM-DD */, active, lastGeneratedMonth /* YYYY-MM | null */
}
```

## Storage

Everything is stored in the browser's `localStorage` — there is no backend or account system, and data does not sync between browsers or devices automatically (the Backup/Restore buttons move a full JSON snapshot between browsers/devices manually). `expenses_data`, `budgets_data` and `recurring_data` each carry a checksum; a mismatch is logged as a warning but the data is loaded anyway rather than discarded. Receipt images are downsized (max 1000px, JPEG, ~70% quality) and rejected if they'd still exceed ~400KB after compression, to avoid exhausting the ~5–10MB `localStorage` quota. Up to 8 categories get a dedicated chart color, assigned by creation order and never reused while that category still exists; categories beyond that (or after enough deletions free a slot, freshly created ones still take the first free slot) share a muted "Other" slot in the charts, but still work normally everywhere else (list, filters, CSV, recurring templates).

`storage.js` centralizes the sanitizing logic (`sanitizeExpensesList`, `sanitizeBudgetsData`, `sanitizeRecurringList`) so that loading from `localStorage` and restoring from an uploaded backup file go through identical validation.

## Constraints

- `index.html` has a strict Content-Security-Policy (`script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'self'`). No inline `<script>`, inline `<style>`, `style=""` or `onclick=""` attributes, and no external resources (fonts, CDNs, chart libraries) — `pdf.min.js`/`pdf.worker.min.js` are vendored (downloaded once and committed) rather than loaded from a CDN. All charts are hand-drawn inline SVG.
- `pdf.min.js`/`pdf.worker.min.js` are pdf.js builds converted from ES modules to classic scripts (their trailing `export {...}` rewritten to a global assignment, and `import.meta` usages in dead Node.js-only code paths neutralized) so they can be loaded via plain `<script src>` tags rather than `type="module"`, which fails under `file://`. `pdf.min.js` is additionally wrapped in an IIFE so its internal top-level `const`/`let` declarations can't collide with the app's own globals, since classic scripts share one scope.
- Scripts are loaded as plain `<script src>` tags (`storage.js`, then `charts.js`, then `app.js`), not ES modules — `type="module"` fails silently when opened via `file://`.
- Any element that can be shown/hidden via the `hidden` attribute must not also carry a CSS `display` rule on the same selector without a matching `[hidden] { display: none; }` override, or the `display` rule wins and the element stays visible.
- New elements added inside an expense `<li>` need a mobile `order` value in the `@media (max-width: 520px)` block in `style.css`, or they'll land in the wrong position on phones — this applies to inline edit-mode fields as much as the normal display fields.
