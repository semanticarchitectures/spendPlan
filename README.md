# SpendPlan

Personal financial planning, budgeting, statement import, and what-if scenario
simulation. Static HTML/CSS/JS, no build step, no backend, no account — it runs
entirely in your browser and stores its data in `localStorage`.

## Running it

Open `index.html` directly in a browser, or serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## What it does

- **Dashboard** — income vs. spending, a 5-year net worth forecast, and spending/asset
  breakdowns, all backed by the same projection engine as the What-If tab.
- **Budget** — expected vs. actual by line item, monthly/annual/5yr/10yr views. Actuals
  are either entered manually or derived automatically from imported transactions.
- **Net Worth** — assets and liabilities, with amortization-aware liability payoff
  estimates (a typical term is assumed per category when you don't enter a payment).
- **Statement Importer** — drag in a CSV or OFX/QFX export from a bank, card, or
  brokerage account. Auto-detects the delimiter, header row, column mapping, and
  charge sign convention; dedupes on re-import via FITID or a content hash.
- **What-If Scenarios** — adjust income/spending/return/inflation and one-off events,
  compare against a baseline and against saved scenarios, and see liability payoff
  and net worth impact.

## Project structure

Parsing, the transaction ledger, and the projection engine are pure, DOM-free,
UMD-wrapped modules — usable from both the browser and Node, and covered by the
unit test suite:

- `parse.js` — CSV/OFX parsing, amount/date normalization, column auto-detection.
- `ledger.js` — transaction dedupe/categorization, budget actuals, snapshot
  normalization for persistence/import.
- `projection.js` — the monthly balance-sheet simulation (asset growth, loan
  amortization, inflation, scenario deltas).

The rest is browser-only DOM glue with no module system — classic `<script>` tags
sharing one global scope, loaded in dependency order by `index.html`:

- `app.js` — state, persistence (`localStorage`), navigation, budget/net-worth
  tables, modals, the import flow.
- `charts.js` — all Chart.js rendering (dashboard charts, scenario comparison,
  payoff timeline).

## Data & privacy

Everything — budget, transactions, assets/liabilities, saved scenarios — is kept in
`localStorage` under the `spendplan_state` key, on your device only; nothing is sent
anywhere. Data is **not encrypted**: anyone with access to the browser profile (or an
exported JSON backup file, from the export/import buttons on the dashboard) can read
it in plain text. Treat backup files the way you'd treat a bank statement.

## Development

```
npm install       # installs eslint + Playwright (for tests/e2e.js)
npm test          # unit tests (parse/ledger/projection) — no dependencies needed
npm run lint      # ESLint
npm run e2e       # headless-browser smoke test — needs `npm install` first
```

See `tests/README.md` for what the test suites cover.
