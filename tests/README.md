# Tests

- `npm test` — unit tests for `parse.js`, `ledger.js` and `projection.js` (Node's built-in test runner, no dependencies).
- `npm run e2e` — headless-browser smoke test that loads the app, checks the demo numbers, imports the
  four fixture statements in `tests/fixtures/`, and verifies dedupe, sign handling, derived actuals,
  persistence, escaping, the v1 → v2 storage migration, and the projection engine wiring
  (liability payments/payoff, per-asset return default, presets, baseline consistency). Needs `npm install` (Playwright) first;
  Chart.js is stubbed if the CDN is unreachable.

Fixtures mirror real export shapes: Chase checking (single signed Amount), Amex card (positive = charge,
quoted thousands), Capital One (split Debit/Credit columns), and an SGML QFX file with FITIDs.

## Projection model (projection.js)

Monthly simulation over 10 years. Assets grow at their own yields; liabilities amortize with a fixed
payment (entered, or estimated from a default term by category) and free that payment when paid off;
income and non-debt expenses inflate, loan payments do not; surplus is invested at the investable
assets' weighted yield; deficits drain cash, then investments. One-offs land in month 1 and can
target investments (market correction) or cash. The dashboard forecast and the What-If baseline are
the same run.
