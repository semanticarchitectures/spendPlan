'use strict';
// Flat ESLint config. SpendPlan has no build step, so this exists purely to catch
// typos/undefined-variable bugs — no bundler-specific rules needed. There is no
// module system: parse.js/ledger.js/projection.js are UMD (run under both Node,
// via require() in tests, and the browser); app.js/charts.js are classic <script>
// tags that share one global scope, so each declares the identifiers it hands to
// the other via the `globals` blocks below.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    // Pure UMD modules: exercised by node --test and loaded by <script> in the browser.
    files: ['parse.js', 'ledger.js', 'projection.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    // State, DOM glue, modals, import flow. Exposes the globals charts.js consumes.
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        renderDashboardCharts: 'readonly',
        renderScenarioCharts: 'readonly'
      }
    }
  },
  {
    // Chart.js rendering; consumes app.js's state/helpers and the CDN Chart global.
    files: ['charts.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Chart: 'readonly',
        state: 'readonly',
        Parse: 'readonly',
        Ledger: 'readonly',
        Projection: 'readonly',
        esc: 'readonly',
        formatCurrency: 'readonly',
        getTimeMultiplier: 'readonly',
        runProjection: 'readonly',
        renderReturnSliderLabel: 'readonly'
      }
    }
  },
  {
    files: ['tests/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    // Playwright driver script: the arrow functions passed to page.addInitScript()/
    // page.evaluate() run inside the browser page, not this Node process, so this
    // file's scope is a mix of both realms.
    files: ['tests/e2e.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
        state: 'readonly',
        renderAll: 'readonly',
        runProjection: 'readonly',
        renderSavedScenariosDropdown: 'readonly',
        SpendPlanLedger: 'readonly',
        SpendPlanProjection: 'readonly'
      }
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    ignores: ['node_modules/**', 'tests/fixtures/**']
  }
];
