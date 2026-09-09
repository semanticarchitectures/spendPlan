/**
 * SpendPlan Core Financial Planning, Statement Importer, & Scenario Engine
 *
 * Depends on parse.js (SpendPlanParse) and ledger.js (SpendPlanLedger), which
 * hold the DOM-free parsing and transaction logic and are unit-tested under tests/.
 */

const Parse = window.SpendPlanParse;
const Ledger = window.SpendPlanLedger;
const Projection = window.SpendPlanProjection;

// STATE MANAGEMENT
// Budget amounts are always stored as MONTHLY figures; `frequency` only records
// how the user prefers to enter/see that line.
const state = {
  timeframe: 'annual', // 'monthly', 'annual', '5years', '10years'
  budget: [],         // { id, name, type: 'income'|'expense', expected, actual, frequency, actualSource?, actualTxCount? }
  assets: [],         // { id, name, category, value: number, yield: number }
  liabilities: [],    // { id, name, category, balance, rate, payment: number|null (null = estimated), inBudget: bool }
  transactions: [],   // canonical records — see ledger.js
  actualsMonths: 'all', // 'all' | 1 | 3 | 6 | 12 — window used to derive actuals from transactions
  actualsSummary: null, // last computeActuals() result (not persisted)
  scenario: {
    incomeChange: 0,   // %
    spendingChange: 0, // %
    returnRate: null,  // % override for investment/retirement assets; null = use each asset's own yield
    inflationRate: 3.0,// %
    oneOffs: []        // { desc, amount }
  },
  savedScenarios: [], // [{ id, name, notes, config: { incomeChange, spendingChange, returnRate, inflationRate, oneOffs } }]
  activeSavedScenarioId: null,
  importPreview: null // { headers, rows, source: 'csv'|'ofx', accountType, accountId }
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initTimeframeSelector();
  initModals();
  initDragAndDrop();
  initScenarioControls();
  initDataExportImport();
  initTableActions();
  initActualsPeriodSelector();

  // Load persisted state or seed sample data
  const loaded = loadFromLocalStorage();
  if (!loaded) {
    seedSampleData();
  } else {
    renderAll();
  }
});

// Collision-resistant id for new records; see Ledger.uid in ledger.js.
const uid = Ledger.uid;

// Escape a string for safe insertion into innerHTML.
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Lightweight, non-blocking notification (replaces alert() for success paths).
function notify(message, kind) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind || 'info'}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 5000);
}

// NAVIGATION & TABS
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  const activePane = document.getElementById(`tab-${tabId}`);

  if (activeBtn && activePane) {
    activeBtn.classList.add('active');
    activePane.classList.add('active');

    // Update Header
    const titles = {
      dashboard: ['Overview Dashboard', 'Real-time financial summary, cash flow, and net worth overview.'],
      budget: ['Budget (Expected vs Actual)', 'Track planned income and spending against real-world actuals.'],
      networth: ['Assets & Liabilities Portfolio', 'Manage your balance sheet and compute total Net Worth.'],
      importer: ['Statement Importer', 'Upload CSV/OFX files from bank, credit card, and brokerage accounts.'],
      scenarios: ['"What-If" Excursion Simulator', 'Simulate financial perturbations, life events, and market conditions.']
    };

    if (titles[tabId]) {
      document.getElementById('page-title').textContent = titles[tabId][0];
      document.getElementById('page-subtitle').textContent = titles[tabId][1];
    }

    if (tabId === 'scenarios') renderScenarioCharts();
    if (tabId === 'dashboard') renderDashboardCharts();
  }
}

// TIMEFRAME SELECTOR
function initTimeframeSelector() {
  const select = document.getElementById('global-timeframe');
  select.addEventListener('change', (e) => {
    state.timeframe = e.target.value;
    renderAll();
  });
}

function getTimeMultiplier() {
  // Budget values stored as Monthly by default
  switch (state.timeframe) {
    case 'monthly': return 1;
    case 'annual': return 12;
    case '5years': return 60;
    case '10years': return 120;
    default: return 12;
  }
}

// Frequency conversion.  Budget lines are stored monthly; the form can show/accept
// annual or weekly figures.
const WEEKS_PER_MONTH = 52 / 12;
function toMonthly(v, frequency) {
  if (frequency === 'annual') return v / 12;
  if (frequency === 'weekly') return v * WEEKS_PER_MONTH;
  return v;
}
function toDisplay(monthly, frequency) {
  if (frequency === 'annual') return Math.round(monthly * 12 * 100) / 100;
  if (frequency === 'weekly') return Math.round(monthly / WEEKS_PER_MONTH * 100) / 100;
  return Math.round(monthly * 100) / 100;
}

// FORMATTERS
function formatCurrency(val) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(val || 0);
}

// SEED SAMPLE DATA
function seedSampleData() {
  state.budget = [
    { id: 'b1', name: 'Primary Salary / Tech Corp', type: 'income', expected: 8500, actual: 8500, frequency: 'monthly' },
    { id: 'b2', name: 'Dividends & Investments', type: 'income', expected: 600, actual: 720, frequency: 'monthly' },
    { id: 'b3', name: 'Housing / Mortgage Payment', type: 'expense', expected: 2800, actual: 2800, frequency: 'monthly' },
    { id: 'b4', name: 'Groceries & Household', type: 'expense', expected: 900, actual: 940, frequency: 'monthly' },
    { id: 'b5', name: 'Utilities & Internet', type: 'expense', expected: 350, actual: 320, frequency: 'monthly' },
    { id: 'b6', name: 'Dining & Entertainment', type: 'expense', expected: 600, actual: 780, frequency: 'monthly' },
    { id: 'b7', name: 'Car Insurance & Gas', type: 'expense', expected: 400, actual: 390, frequency: 'monthly' },
    { id: 'b8', name: 'Health & Personal Care', type: 'expense', expected: 300, actual: 250, frequency: 'monthly' },
    // Annual lines are stored as monthly (6000/yr → 500/mo); `frequency` only affects the edit form.
    { id: 'b9', name: 'Vacation & Travel', type: 'expense', expected: 500, actual: 350, frequency: 'annual' },
    { id: 'b10', name: 'Clothing & Personal', type: 'expense', expected: 200, actual: 150, frequency: 'annual' }
  ];

  state.assets = [
    { id: 'a1', name: 'High-Yield Savings (Emergency Fund)', category: 'Cash / Liquid', value: 35000, yield: 4.5 },
    { id: 'a2', name: '401(k) Index Funds', category: 'Retirement', value: 145000, yield: 8.0 },
    { id: 'a3', name: 'Roth IRA (Vanguard S&P 500)', category: 'Retirement', value: 48000, yield: 8.5 },
    { id: 'a4', name: 'Taxable Brokerage (Fidelity)', category: 'Investment / Stocks', value: 62000, yield: 7.5 },
    { id: 'a5', name: 'Primary Residence (Est. Market)', category: 'Real Estate', value: 520000, yield: 3.5 }
  ];

  state.liabilities = [
    // payment = monthly amount; inBudget = that payment already sits inside a budget expense line
    { id: 'l1', name: 'Primary Mortgage (30-Yr Fixed)', category: 'Mortgage', balance: 340000, rate: 3.8, payment: 1585, inBudget: true },   // inside "Housing"
    { id: 'l2', name: 'Tesla Auto Loan', category: 'Auto Loan', balance: 18500, rate: 4.2, payment: 425, inBudget: false },
    { id: 'l3', name: 'Chase Sapphire Credit Card', category: 'Credit Card', balance: 1450, rate: 19.9, payment: 150, inBudget: false }
  ];

  const seedTxs = [
    { date: '2026-09-01', account: 'Chase Checking', accountType: 'checking', description: 'TECH CORP PAYROLL DIRECT DEP', category: null, amount: 4250, source: 'demo' },
    { date: '2026-09-02', account: 'Chase Checking', accountType: 'checking', description: 'MORTGAGE AUTO PAY', category: null, amount: -2800, source: 'demo' },
    { date: '2026-09-03', account: 'Amex Credit Card', accountType: 'credit', description: 'WHOLE FOODS MARKET', category: null, amount: -245.50, source: 'demo' },
    { date: '2026-09-05', account: 'Fidelity Brokerage', accountType: 'investment', description: 'Q3 DIVIDEND PAYOUT', category: null, amount: 360, source: 'demo' }
  ];
  state.transactions = Ledger.mergeTransactions([], seedTxs).transactions;
  state.actualsSummary = null; // demo actuals above are manual; they are not re-derived from these few sample rows

  saveToLocalStorage();
  renderAll();
}

document.getElementById('btn-seed-sample').addEventListener('click', () => {
  if (confirm('Load pre-populated demo financial dataset?')) {
    seedSampleData();
  }
});

// RENDERERS
function renderAll() {
  const mult = getTimeMultiplier();

  // Calculations
  const expIncome = state.budget.filter(i => i.type === 'income').reduce((s, i) => s + i.expected, 0) * mult;
  const actIncome = state.budget.filter(i => i.type === 'income').reduce((s, i) => s + i.actual, 0) * mult;

  const expSpending = state.budget.filter(i => i.type === 'expense').reduce((s, i) => s + i.expected, 0) * mult;
  const actSpending = state.budget.filter(i => i.type === 'expense').reduce((s, i) => s + i.actual, 0) * mult;

  const totalAssets = state.assets.reduce((s, a) => s + Number(a.value), 0);
  const totalLiabilities = state.liabilities.reduce((s, l) => s + Number(l.balance), 0);
  const netWorth = totalAssets - totalLiabilities;
  const netCashFlow = actIncome - actSpending;

  // Header & Quick Stats
  document.getElementById('quick-net-worth').textContent = formatCurrency(netWorth);
  document.getElementById('quick-cash-flow').textContent = formatCurrency(netCashFlow);
  document.getElementById('quick-cash-flow').className = `stat-val ${netCashFlow >= 0 ? 'text-success' : 'text-danger'}`;

  // Dashboard Metrics
  document.getElementById('dash-expected-income').textContent = formatCurrency(expIncome);
  document.getElementById('dash-actual-income-sub').textContent = `Actual: ${formatCurrency(actIncome)}`;

  document.getElementById('dash-expected-spending').textContent = formatCurrency(expSpending);
  document.getElementById('dash-actual-spending-sub').textContent = `Actual: ${formatCurrency(actSpending)}`;

  document.getElementById('dash-total-assets').textContent = formatCurrency(totalAssets);
  document.getElementById('dash-total-liabilities').textContent = formatCurrency(totalLiabilities);

  // Health Ratios
  const savingsRate = actIncome > 0 ? Math.round(((actIncome - actSpending) / actIncome) * 100) : 0;
  document.getElementById('val-savings-rate').textContent = `${savingsRate}%`;
  document.getElementById('bar-savings-rate').style.width = `${Math.max(0, Math.min(100, savingsRate))}%`;

  const debtRatio = totalAssets > 0 ? Math.round((totalLiabilities / totalAssets) * 100) : 0;
  document.getElementById('val-debt-ratio').textContent = `${debtRatio}%`;
  document.getElementById('bar-debt-ratio').style.width = `${Math.max(0, Math.min(100, debtRatio))}%`;

  const liquidAssets = state.assets.filter(a => a.category.includes('Cash')).reduce((s, a) => s + Number(a.value), 0);
  const monthlyExpense = actSpending / mult;
  const emergencyMonths = monthlyExpense > 0 ? (liquidAssets / monthlyExpense).toFixed(1) : '0';
  document.getElementById('val-emergency-coverage').textContent = `${emergencyMonths} Months`;
  document.getElementById('bar-emergency-coverage').style.width = `${Math.min(100, (emergencyMonths / 6) * 100)}%`;

  // Render Sub-Tables & Views
  renderBudgetTable();
  renderActualsPeriodInfo();
  renderNetWorthTables();
  renderRecentTransactions();
  renderDashboardCharts();
  renderScenarioCharts();
}

// BUDGET TABLE RENDER
function renderBudgetTable() {
  const tbody = document.getElementById('tbody-budget');
  const search = document.getElementById('budget-search').value.toLowerCase();
  const filterType = document.getElementById('budget-type-filter').value;
  const mult = getTimeMultiplier();

  tbody.innerHTML = '';

  const filtered = state.budget.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search);
    const matchesType = filterType === 'all' || item.type === filterType;
    return matchesSearch && matchesType;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No budget items match criteria.</td></tr>`;
    return;
  }

  filtered.forEach(item => {
    const exp = item.expected * mult;
    const act = item.actual * mult;
    const variance = item.type === 'income' ? act - exp : exp - act; // Positive means good
    const isFavorable = variance >= 0;

    const fromTx = item.actualSource === 'transactions';
    const srcTitle = fromTx
      ? `Derived from ${item.actualTxCount || 0} imported transaction(s) over the selected period`
      : 'Entered manually (no matching transactions imported)';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(item.name)}</strong></td>
      <td><span class="badge ${item.type === 'income' ? 'badge-success' : 'badge-accent'}">${esc(item.type.toUpperCase())}</span></td>
      <td>${formatCurrency(exp)}</td>
      <td>${formatCurrency(act)} <span class="source-tag ${fromTx ? 'from-tx' : 'manual'}" title="${esc(srcTitle)}">${fromTx ? 'imported' : 'manual'}</span></td>
      <td class="${isFavorable ? 'text-success' : 'text-danger'} font-weight-bold">
        ${isFavorable ? '+' : ''}${formatCurrency(variance)}
      </td>
      <td>
        <span class="badge ${isFavorable ? 'badge-success' : 'badge-danger'}">
          ${isFavorable ? 'Favorable' : 'Over Budget'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm btn-secondary" data-action="edit-budget" data-id="${esc(item.id)}">Edit</button>
        <button class="btn btn-sm btn-outline text-danger" data-action="delete-budget" data-id="${esc(item.id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderActualsPeriodInfo() {
  const el = document.getElementById('actuals-period-info');
  const sel = document.getElementById('actuals-months');
  if (sel) sel.value = String(state.actualsMonths);
  if (!el) return;
  const s = state.actualsSummary;
  if (!s || !s.period) {
    el.textContent = state.transactions.length
      ? 'Actuals are manual. Import a statement to derive them from transactions.'
      : 'No transactions imported yet — actuals are the values you entered.';
    return;
  }
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const matched = Object.keys(s.byItem).length;
  let msg = `Actuals = monthly average of ${s.considered} transactions over ${s.months} complete month${s.months === 1 ? '' : 's'} (${fmt(s.period.start)} – ${fmt(s.period.end)}), matched to ${matched} budget line${matched === 1 ? '' : 's'}.`;
  const latest = Ledger.sortByDateDesc(state.transactions)[0];
  if (latest && latest.date > s.period.end) msg += ' The current month is excluded until it ends.';
  if (s.unmatched.count) msg += ` ${s.unmatched.count} unmatched (${formatCurrency(s.unmatched.income)} in / ${formatCurrency(s.unmatched.expense)} out).`;
  if (s.unmatched.transfers) msg += ` Transfers & card payments excluded: ${formatCurrency(s.unmatched.transfers)}.`;
  el.textContent = msg;
}

// Run the projection engine against current state.
function runProjection(scenario, months) {
  return Projection.project({
    budget: state.budget,
    assets: state.assets,
    liabilities: state.liabilities,
    scenario: scenario,
    months: months || Projection.HORIZON_MONTHS
  });
}

// Recompute budget actuals from the transaction ledger for the chosen window.
function recomputeActuals() {
  if (state.transactions.length === 0) { state.actualsSummary = null; return; }
  const period = state.actualsMonths === 'all'
    ? Ledger.periodFromTransactions(state.transactions)
    : Ledger.lastNMonthsPeriod(state.transactions, Number(state.actualsMonths));
  const summary = Ledger.computeActuals(state.transactions, state.budget, period);
  state.budget = Ledger.applyActuals(state.budget, summary);
  state.actualsSummary = summary;
}

function initActualsPeriodSelector() {
  const sel = document.getElementById('actuals-months');
  if (!sel) return;
  sel.addEventListener('change', (e) => {
    const v = e.target.value;
    state.actualsMonths = v === 'all' ? 'all' : Number(v);
    recomputeActuals();
    saveToLocalStorage();
    renderAll();
  });
}

// Event delegation for row buttons (no inline onclick, so ids are never interpolated into JS).
function initTableActions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    switch (btn.getAttribute('data-action')) {
      case 'edit-budget': editBudgetItem(id); break;
      case 'delete-budget': deleteBudgetItem(id); break;
      case 'edit-asset': editAssetItem(id); break;
      case 'delete-asset': deleteAssetItem(id); break;
      case 'edit-liability': editLiabilityItem(id); break;
      case 'delete-liability': deleteLiabilityItem(id); break;
      case 'remove-one-off': removeOneOff(Number(btn.getAttribute('data-index'))); break;
    }
  });
}

document.getElementById('budget-search').addEventListener('input', renderBudgetTable);
document.getElementById('budget-type-filter').addEventListener('change', renderBudgetTable);

// ASSETS & LIABILITIES RENDER
function renderNetWorthTables() {
  const tbodyAssets = document.getElementById('tbody-assets');
  const tbodyLiabilities = document.getElementById('tbody-liabilities');

  tbodyAssets.innerHTML = '';
  tbodyLiabilities.innerHTML = '';

  let totalA = 0;
  state.assets.forEach(asset => {
    totalA += Number(asset.value);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(asset.name)}</strong></td>
      <td><span class="badge badge-accent">${esc(asset.category)}</span></td>
      <td>${formatCurrency(asset.value)}</td>
      <td>${esc(asset.yield)}% ARR</td>
      <td>
        <button class="btn btn-sm btn-secondary" data-action="edit-asset" data-id="${esc(asset.id)}">Edit</button>
        <button class="btn btn-sm btn-outline text-danger" data-action="delete-asset" data-id="${esc(asset.id)}">Delete</button>
      </td>
    `;
    tbodyAssets.appendChild(tr);
  });
  document.getElementById('total-assets-badge').textContent = formatCurrency(totalA);

  let totalL = 0;
  const today = new Date().toISOString().slice(0, 10);
  state.liabilities.forEach(liab => {
    totalL += Number(liab.balance);
    const payment = Projection.liabilityPayment(liab);
    const estimated = Projection.isPaymentEstimated(liab);
    const sched = Projection.amortizationSchedule(liab, 600);
    const payoff = sched.neverPaysOff
      ? '<span class="text-danger" title="Payment does not cover interest, or takes more than 50 years">never</span>'
      : `${esc(Projection.monthLabel(today, sched.payoffMonth))} <span class="text-muted">(${sched.payoffMonth < 24 ? sched.payoffMonth + ' mo' : Math.round(sched.payoffMonth / 12) + ' yrs'})</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(liab.name)}</strong>${liab.inBudget === false ? ' <span class="source-tag" title="This payment is not in any budget expense line; the projection subtracts it separately">not in budget</span>' : ''}</td>
      <td><span class="badge badge-danger">${esc(liab.category)}</span></td>
      <td>${formatCurrency(liab.balance)}</td>
      <td>${esc(liab.rate)}% APR</td>
      <td>${formatCurrency(payment)}${estimated ? ` <span class="source-tag" title="Estimated from a ${Projection.defaultTermMonths(liab.category) / 12}-year term — edit to enter your real payment">est.</span>` : ''}</td>
      <td title="Total interest until payoff: ${formatCurrency(sched.totalInterest)}">${payoff}</td>
      <td>
        <button class="btn btn-sm btn-secondary" data-action="edit-liability" data-id="${esc(liab.id)}">Edit</button>
        <button class="btn btn-sm btn-outline text-danger" data-action="delete-liability" data-id="${esc(liab.id)}">Delete</button>
      </td>
    `;
    tbodyLiabilities.appendChild(tr);
  });
  document.getElementById('total-liabilities-badge').textContent = formatCurrency(totalL);
}

// RECENT TRANSACTIONS TABLE
function renderRecentTransactions() {
  const tbody = document.getElementById('tbody-recent-txs');
  tbody.innerHTML = '';

  if (state.transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No statement transactions logged yet.</td></tr>`;
    return;
  }

  const recent = Ledger.sortByDateDesc(state.transactions).slice(0, 8);
  recent.forEach(tx => {
    const cat = Ledger.categorize(tx);
    const isTransfer = Ledger.isTransfer(tx);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(tx.date)}</td>
      <td><span class="badge badge-accent">${esc(tx.account)}</span></td>
      <td>${esc(tx.description)}</td>
      <td>${isTransfer ? '<span class="text-muted">Transfer</span>' : esc(cat || 'Uncategorized')}</td>
      <td class="${tx.amount >= 0 ? 'text-success' : 'text-danger'} font-weight-bold">
        ${tx.amount >= 0 ? '+' : ''}${formatCurrency(tx.amount)}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// renderDashboardCharts(), renderSpendingDonut(), and renderAssetDonut() live in charts.js.

// "WHAT-IF" SCENARIO SIMULATOR
function initScenarioControls() {
  document.getElementById('slider-scen-income').addEventListener('input', (e) => {
    state.scenario.incomeChange = parseFloat(e.target.value);
    document.getElementById('val-scen-income').textContent = `${state.scenario.incomeChange >= 0 ? '+' : ''}${state.scenario.incomeChange}%`;
    renderScenarioCharts();
  });

  document.getElementById('slider-scen-spending').addEventListener('input', (e) => {
    state.scenario.spendingChange = parseFloat(e.target.value);
    document.getElementById('val-scen-spending').textContent = `${state.scenario.spendingChange >= 0 ? '+' : ''}${state.scenario.spendingChange}%`;
    renderScenarioCharts();
  });

  document.getElementById('slider-scen-return').addEventListener('input', (e) => {
    state.scenario.returnRate = parseFloat(e.target.value);
    renderReturnSliderLabel();
    renderScenarioCharts();
  });
  document.getElementById('btn-scen-return-auto').addEventListener('click', () => {
    state.scenario.returnRate = null;
    renderReturnSliderLabel();
    renderScenarioCharts();
  });

  document.getElementById('slider-scen-inflation').addEventListener('input', (e) => {
    state.scenario.inflationRate = parseFloat(e.target.value);
    document.getElementById('val-scen-inflation').textContent = `${state.scenario.inflationRate}%`;
    renderScenarioCharts();
  });

  document.getElementById('btn-add-one-off').addEventListener('click', () => {
    const desc = document.getElementById('scen-one-off-desc').value.trim();
    const amount = parseFloat(document.getElementById('scen-one-off-amount').value);
    if (desc && !isNaN(amount)) {
      state.scenario.oneOffs.push({ desc, amount });
      document.getElementById('scen-one-off-desc').value = '';
      document.getElementById('scen-one-off-amount').value = '';
      renderOneOffList();
      renderScenarioCharts();
    }
  });

  // Compare All Saved toggle
  document.getElementById('toggle-compare-all').addEventListener('change', () => {
    renderScenarioCharts();
  });

  // Saved Scenario Management
  document.getElementById('btn-save-scenario-modal').addEventListener('click', () => {
    openModal('modal-save-scenario');
  });

  document.getElementById('form-save-scenario').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('scenario-name-input').value.trim();
    const notes = document.getElementById('scenario-notes-input').value.trim();

    if (!name) return;

    const newScenario = {
      id: uid('scen'),
      name: name,
      notes: notes,
      config: JSON.parse(JSON.stringify(state.scenario))
    };

    state.savedScenarios.push(newScenario);
    state.activeSavedScenarioId = newScenario.id;
    saveToLocalStorage();
    renderSavedScenariosDropdown();
    closeModal('modal-save-scenario');
    notify(`Scenario "${name}" saved.`, "success");
  });

  document.getElementById('saved-scenarios-select').addEventListener('change', (e) => {
    const scenId = e.target.value;
    state.activeSavedScenarioId = scenId || null;
    if (scenId) {
      loadSavedScenario(scenId);
    }
    updateSavedScenarioActionButtons();
  });

  document.getElementById('btn-load-scenario').addEventListener('click', () => {
    if (state.activeSavedScenarioId) {
      loadSavedScenario(state.activeSavedScenarioId);
    }
  });

  document.getElementById('btn-rename-scenario').addEventListener('click', () => {
    if (!state.activeSavedScenarioId) return;
    const scen = state.savedScenarios.find(s => s.id === state.activeSavedScenarioId);
    if (scen) {
      const newName = prompt('Enter new scenario title:', scen.name);
      if (newName && newName.trim()) {
        scen.name = newName.trim();
        saveToLocalStorage();
        renderSavedScenariosDropdown();
      }
    }
  });

  document.getElementById('btn-delete-scenario').addEventListener('click', () => {
    if (!state.activeSavedScenarioId) return;
    const scen = state.savedScenarios.find(s => s.id === state.activeSavedScenarioId);
    if (scen && confirm(`Delete saved scenario "${scen.name}"?`)) {
      state.savedScenarios = state.savedScenarios.filter(s => s.id !== state.activeSavedScenarioId);
      state.activeSavedScenarioId = null;
      saveToLocalStorage();
      renderSavedScenariosDropdown();
      resetScenario();
    }
  });
}

function renderSavedScenariosDropdown() {
  const select = document.getElementById('saved-scenarios-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Active Sandbox (Unsaved) --</option>';

  state.savedScenarios.forEach(scen => {
    const opt = document.createElement('option');
    opt.value = scen.id;
    opt.textContent = `${scen.name} (${scen.config.incomeChange >= 0 ? '+' : ''}${scen.config.incomeChange}% Inc / ${scen.config.spendingChange >= 0 ? '+' : ''}${scen.config.spendingChange}% Spend)`;
    if (scen.id === state.activeSavedScenarioId) opt.selected = true;
    select.appendChild(opt);
  });

  updateSavedScenarioActionButtons();
}

function updateSavedScenarioActionButtons() {
  const actionsDiv = document.getElementById('saved-scenario-actions');
  if (actionsDiv) {
    actionsDiv.style.display = state.activeSavedScenarioId ? 'flex' : 'none';
    actionsDiv.style.gap = '8px';
  }
}

function loadSavedScenario(id) {
  const scen = state.savedScenarios.find(s => s.id === id);
  if (scen) {
    state.scenario = JSON.parse(JSON.stringify(scen.config));
    setScenarioValues(scen.config.incomeChange, scen.config.spendingChange, scen.config.returnRate, scen.config.inflationRate);
    renderOneOffList();
  }
}

function renderOneOffList() {
  const ul = document.getElementById('one-off-list');
  ul.innerHTML = '';
  state.scenario.oneOffs.forEach((item, index) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.marginTop = '6px';
    li.innerHTML = `
      <span>${esc(item.desc)} (${formatCurrency(item.amount)}${item.target === 'investable' ? ', from investments' : ''})</span>
      <button class="btn btn-sm btn-text text-danger" data-action="remove-one-off" data-index="${index}">&times;</button>
    `;
    ul.appendChild(li);
  });
}

function removeOneOff(index) {
  state.scenario.oneOffs.splice(index, 1);
  renderOneOffList();
  renderScenarioCharts();
}

function applyScenarioPreset(preset) {
  const D = Projection.DEFAULT_INFLATION;
  if (preset === 'jobChange') {
    state.scenario.oneOffs = [];
    setScenarioValues(15, 5, null, D);
  } else if (preset === 'homePurchase') {
    state.scenario.oneOffs = [{ desc: 'Home down payment', amount: -60000 }];
    setScenarioValues(0, 15, null, D);
  } else if (preset === 'marketCrash') {
    // A correction is a one-time hit to what you hold today, not a permanent negative return.
    const hit = Math.round(Projection.investableValue(state.assets) * 0.20);
    state.scenario.oneOffs = hit > 0 ? [{ desc: 'Market correction (−20% of investments)', amount: -hit, target: 'investable' }] : [];
    setScenarioValues(0, 0, null, D);
  } else if (preset === 'earlyRetirement') {
    state.scenario.oneOffs = [];
    setScenarioValues(-80, -30, null, 2.5);
  }
  renderOneOffList();
}

function resetScenario() {
  state.scenario.oneOffs = [];
  setScenarioValues(0, 0, null, Projection.DEFAULT_INFLATION);
  renderOneOffList();
}

// The return slider is an override for Investment/Retirement assets; null means
// "use each asset's own yield", which is also what the baseline uses.
function renderReturnSliderLabel() {
  const slider = document.getElementById('slider-scen-return');
  const label = document.getElementById('val-scen-return');
  const auto = document.getElementById('btn-scen-return-auto');
  const avg = Projection.weightedInvestableYield(state.assets);
  const ret = state.scenario.returnRate;
  if (ret === null || ret === undefined) {
    slider.value = avg === null ? 0 : Math.round(avg * 2) / 2;
    label.textContent = avg === null ? 'n/a' : `${(Math.round(avg * 10) / 10)}% (per-asset)`;
    if (auto) auto.style.display = 'none';
  } else {
    slider.value = ret;
    label.textContent = `${ret}% (override)`;
    if (auto) auto.style.display = '';
  }
}

function setScenarioValues(inc, spend, ret, inf) {
  state.scenario.incomeChange = inc;
  state.scenario.spendingChange = spend;
  state.scenario.returnRate = (ret === null || ret === undefined || isNaN(ret)) ? null : ret;
  state.scenario.inflationRate = inf;

  document.getElementById('slider-scen-income').value = inc;
  document.getElementById('val-scen-income').textContent = `${inc >= 0 ? '+' : ''}${inc}%`;

  document.getElementById('slider-scen-spending').value = spend;
  document.getElementById('val-scen-spending').textContent = `${spend >= 0 ? '+' : ''}${spend}%`;

  renderReturnSliderLabel();

  document.getElementById('slider-scen-inflation').value = inf;
  document.getElementById('val-scen-inflation').textContent = `${inf}%`;

  renderScenarioCharts();
}

// renderPayoffTimeline() and renderScenarioCharts() live in charts.js.

// STATEMENT IMPORTER (CSV / OFX / QFX)
// Parsing lives in parse.js; this section only handles the UI flow:
//   file → preview + column mapping → canonical transactions → ledger merge → actuals.
function initDragAndDrop() {
  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('statement-file-input');

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleStatementFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleStatementFile(file);
    e.target.value = ''; // allow re-selecting the same file
  });

  document.getElementById('btn-process-import').addEventListener('click', processImportedStatement);

  // Re-render the preview whenever the mapping changes so the user sees parse results live.
  ['map-account-type', 'map-date-col', 'map-desc-col', 'map-amount-col', 'map-debit-col', 'map-credit-col', 'map-category-col', 'map-fitid-col', 'map-invert', 'map-dayfirst']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        if (id === 'map-account-type') suggestInvertFromPreview();
        renderImportPreview();
      });
    });
}

function handleStatementFile(file) {
  document.getElementById('import-filename-badge').textContent = file.name;
  const reader = new FileReader();

  reader.onload = (e) => {
    const content = e.target.result;
    const lowerName = file.name.toLowerCase();
    const isOFX = lowerName.endsWith('.ofx') || lowerName.endsWith('.qfx') || /<OFX>/i.test(content);

    let preview;
    if (isOFX) {
      const r = Parse.parseOFX(content);
      preview = { headers: r.headers, rows: r.rows, source: 'ofx', accountType: r.accountType, accountId: r.accountId, balance: r.balance, fileName: file.name };
    } else {
      const r = Parse.parseCSV(content);
      preview = { headers: r.headers, rows: r.rows, source: 'csv', accountType: null, accountId: '', balance: null, fileName: file.name };
    }

    if (!preview.rows.length) {
      notify(`No transactions found in ${file.name}. Check that it is a CSV or OFX/QFX export.`, 'error');
      return;
    }

    state.importPreview = preview;
    setupImportMapping(preview);
    renderImportPreview();
    document.getElementById('importer-preview-card').style.display = 'block';
    document.getElementById('importer-preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  reader.readAsText(file);
}

function setupImportMapping(preview) {
  const { headers } = preview;
  const selects = ['map-date-col', 'map-desc-col', 'map-amount-col', 'map-debit-col', 'map-credit-col', 'map-category-col', 'map-fitid-col'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="-1">-- None --</option>';
    headers.forEach((h, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = h || `(column ${idx + 1})`;
      sel.appendChild(opt);
    });
  });

  const m = Parse.detectColumns(headers);
  document.getElementById('map-date-col').value = m.date;
  document.getElementById('map-desc-col').value = m.description;
  document.getElementById('map-amount-col').value = m.amount;
  document.getElementById('map-debit-col').value = m.debit;
  document.getElementById('map-credit-col').value = m.credit;
  document.getElementById('map-category-col').value = m.category;
  document.getElementById('map-fitid-col').value = m.fitid;

  if (preview.source === 'ofx') {
    document.getElementById('map-account-type').value = preview.accountType || 'checking';
    document.getElementById('map-account-label').value = preview.accountId ? `${(preview.accountType || 'account')} ••••${preview.accountId.slice(-4)}` : 'Imported OFX account';
    document.getElementById('map-invert').checked = false; // OFX amounts are already signed correctly
  } else {
    // Guess the account type from the header shape; user can override.
    const joined = headers.join(' ').toLowerCase();
    const type = /card|credit/.test(joined) && !/deposit/.test(joined) ? 'credit' : 'checking';
    document.getElementById('map-account-type').value = type;
    document.getElementById('map-account-label').value = preview.fileName.replace(/\.[^.]+$/, '').slice(0, 40);
    suggestInvertFromPreview();
  }
  document.getElementById('map-dayfirst').checked = false;
}

function currentMapping() {
  const g = (id) => parseInt(document.getElementById(id).value, 10);
  return {
    date: g('map-date-col'),
    description: g('map-desc-col'),
    amount: g('map-amount-col'),
    debit: g('map-debit-col'),
    credit: g('map-credit-col'),
    category: g('map-category-col'),
    fitid: g('map-fitid-col')
  };
}

function currentImportOptions() {
  const accountType = document.getElementById('map-account-type').value;
  const label = document.getElementById('map-account-label').value.trim();
  return {
    accountType,
    accountLabel: label || accountType,
    invert: document.getElementById('map-invert').checked,
    dayFirst: document.getElementById('map-dayfirst').checked,
    source: state.importPreview ? state.importPreview.source : 'import'
  };
}

// For credit card CSVs, guess whether positive numbers are charges.
function suggestInvertFromPreview() {
  const p = state.importPreview;
  if (!p || p.source === 'ofx') return;
  const m = currentMapping();
  const accountType = document.getElementById('map-account-type').value;
  const amounts = p.rows.map(r => m.amount >= 0
    ? Parse.parseAmount(r[m.amount])
    : (Parse.parseAmount(r[m.credit]) || 0) - (Parse.parseAmount(r[m.debit]) || 0));
  document.getElementById('map-invert').checked = Parse.suggestInvert(amounts, accountType);
}

function renderImportPreview() {
  const p = state.importPreview;
  if (!p) return;
  const thead = document.getElementById('preview-table-head');
  const tbody = document.getElementById('preview-table-body');
  const summary = document.getElementById('import-parse-summary');

  const mapping = currentMapping();
  const options = currentImportOptions();
  const { transactions, skipped } = Parse.rowsToTransactions(p.rows, mapping, options);

  // Build a lookup of parsed results by row index for the preview.
  const parsedByRow = new Map();
  let ti = 0;
  const skippedIdx = new Set(skipped.map(s => s.rowIndex));
  p.rows.forEach((_, i) => { if (!skippedIdx.has(i)) parsedByRow.set(i, transactions[ti++]); });
  const skipReason = new Map(skipped.map(s => [s.rowIndex, s.reason]));

  thead.innerHTML = '<th>#</th><th>Parsed Date</th><th>Parsed Amount</th>' + p.headers.map(h => `<th>${esc(h)}</th>`).join('');
  tbody.innerHTML = p.rows.slice(0, 10).map((r, i) => {
    const tx = parsedByRow.get(i);
    const status = tx
      ? `<td>${esc(tx.date)}</td><td class="${tx.amount >= 0 ? 'text-success' : 'text-danger'}">${tx.amount >= 0 ? '+' : ''}${esc(tx.amount.toFixed(2))}</td>`
      : `<td colspan="2" class="text-danger">skipped: ${esc(skipReason.get(i))}</td>`;
    return `<tr class="${tx ? '' : 'row-skipped'}"><td class="text-muted">${i + 1}</td>${status}${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`;
  }).join('');

  const period = Ledger.periodFromTransactions(transactions);
  const inflow = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const dupes = Ledger.mergeTransactions(state.transactions, transactions).skipped.length;

  let msg = `${transactions.length} of ${p.rows.length} rows parse cleanly`;
  if (skipped.length) msg += ` (${skipped.length} will be skipped)`;
  if (period) msg += ` · ${period.start} → ${period.end}`;
  msg += ` · in ${formatCurrency(inflow)} / out ${formatCurrency(outflow)}`;
  if (dupes) msg += ` · ${dupes} already imported (will be ignored)`;
  if (options.accountType === 'credit' && !options.invert && inflow > Math.abs(outflow)) {
    msg += ' · ⚠ more money in than out on a credit card — check "positive = charge"';
  }
  summary.textContent = msg;

  const btn = document.getElementById('btn-process-import');
  btn.disabled = transactions.length === 0;
  btn.textContent = transactions.length ? `Import ${transactions.length - dupes} New Transaction${transactions.length - dupes === 1 ? '' : 's'}` : 'Nothing to import';
}

function processImportedStatement() {
  const p = state.importPreview;
  if (!p) return;
  const mapping = currentMapping();
  if (mapping.date === -1 || (mapping.amount === -1 && mapping.debit === -1 && mapping.credit === -1)) {
    notify('Select a Date column and either an Amount column or Debit/Credit columns.', 'error');
    return;
  }

  const { transactions, skipped } = Parse.rowsToTransactions(p.rows, mapping, currentImportOptions());
  const merged = Ledger.mergeTransactions(state.transactions, transactions);
  state.transactions = merged.transactions;

  recomputeActuals();
  saveToLocalStorage();
  renderAll();

  const parts = [`Imported ${merged.added.length} transaction${merged.added.length === 1 ? '' : 's'}`];
  if (merged.skipped.length) parts.push(`${merged.skipped.length} duplicate${merged.skipped.length === 1 ? '' : 's'} ignored`);
  if (skipped.length) parts.push(`${skipped.length} unparseable row${skipped.length === 1 ? '' : 's'} skipped`);
  notify(parts.join(' · ') + '. Budget actuals recalculated.', 'success');

  state.importPreview = null;
  document.getElementById('importer-preview-card').style.display = 'none';
  switchTab('budget');
}

// MODAL CONTROLS
function initModals() {
  document.getElementById('form-budget').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('budget-item-id').value;
    const name = document.getElementById('budget-item-name').value;
    const type = document.getElementById('budget-item-type').value;
    const frequency = document.getElementById('budget-item-frequency').value || 'monthly';
    const expectedRaw = parseFloat(document.getElementById('budget-item-expected').value);
    const actualRaw = parseFloat(document.getElementById('budget-item-actual').value);
    if (isNaN(expectedRaw)) return;

    // Normalize to monthly.  A blank actual defaults to expected; an explicit 0 is kept as 0.
    const expected = toMonthly(expectedRaw, frequency);
    const actualProvided = !isNaN(actualRaw);
    const prev = id ? state.budget.find(b => b.id === id) : null;
    const edit = {
      name, type, frequency, expected,
      actualProvided,
      actualMonthly: actualProvided ? toMonthly(actualRaw, frequency) : null,
      // Distinguishes "user typed a new actual" from "form re-saved untouched".
      actualChanged: actualProvided && prev ? actualRaw !== toDisplay(prev.actual, frequency) : false
    };
    const next = Ledger.applyBudgetEdit(prev, edit);

    if (id) {
      const idx = state.budget.findIndex(b => b.id === id);
      if (idx !== -1) state.budget[idx] = next;
    } else {
      state.budget.push(next);
    }

    closeModal('modal-add-budget');
    recomputeActuals(); // a renamed/added line may now match imported transactions
    saveToLocalStorage();
    renderAll();
  });

  document.getElementById('form-asset').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('asset-item-id').value;
    const name = document.getElementById('asset-name').value;
    const category = document.getElementById('asset-category').value;
    const value = parseFloat(document.getElementById('asset-value').value);
    const yieldVal = parseFloat(document.getElementById('asset-yield').value) || 0;
    if (isNaN(value)) return;

    if (id) {
      const idx = state.assets.findIndex(a => a.id === id);
      if (idx !== -1) state.assets[idx] = { id, name, category, value, yield: yieldVal };
    } else {
      state.assets.push({ id: uid('a'), name, category, value, yield: yieldVal });
    }

    closeModal('modal-add-asset');
    saveToLocalStorage();
    renderAll();
  });

  ['liability-balance', 'liability-rate', 'liability-category'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLiabilityPaymentHint);
    document.getElementById(id).addEventListener('change', updateLiabilityPaymentHint);
  });

  document.getElementById('form-liability').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('liability-item-id').value;
    const name = document.getElementById('liability-name').value;
    const category = document.getElementById('liability-category').value;
    const balance = parseFloat(document.getElementById('liability-balance').value);
    const rate = parseFloat(document.getElementById('liability-rate').value) || 0;
    const paymentRaw = parseFloat(document.getElementById('liability-payment').value);
    const payment = paymentRaw > 0 ? paymentRaw : null;
    const inBudget = document.getElementById('liability-in-budget').checked;
    if (isNaN(balance)) return;
    const rec = { name, category, balance, rate, payment, inBudget };

    if (id) {
      const idx = state.liabilities.findIndex(l => l.id === id);
      if (idx !== -1) state.liabilities[idx] = Object.assign({ id }, rec);
    } else {
      state.liabilities.push(Object.assign({ id: uid('l') }, rec));
    }

    closeModal('modal-add-liability');
    saveToLocalStorage();
    renderAll();
  });
}

// Show the estimated payment as a placeholder while the user fills in the liability form.
function updateLiabilityPaymentHint() {
  const balance = parseFloat(document.getElementById('liability-balance').value) || 0;
  const rate = parseFloat(document.getElementById('liability-rate').value) || 0;
  const category = document.getElementById('liability-category').value;
  const est = Projection.loanPayment(balance, rate, Projection.defaultTermMonths(category));
  const input = document.getElementById('liability-payment');
  const hint = document.getElementById('liability-payment-hint');
  input.placeholder = est > 0 ? est.toFixed(2) : '0.00';
  if (hint) hint.textContent = est > 0
    ? `Leave blank to assume ${formatCurrency(est)}/mo (a ${Projection.defaultTermMonths(category) / 12}-year payoff at ${rate}%).`
    : 'Leave blank to estimate from the balance, rate, and a typical term for this category.';
}

function openModal(id) {
  if (id === 'modal-add-liability' && !document.getElementById('liability-item-id').value) {
    document.getElementById('liability-in-budget').checked = true;
    updateLiabilityPaymentHint();
  }
  if (id === 'modal-add-budget' && !document.getElementById('budget-item-id').value) {
    document.getElementById('modal-budget-title').textContent = 'Add Budget Item';
    const hint = document.getElementById('budget-actual-hint');
    if (hint) hint.textContent = 'Leave blank to use the expected amount.';
  }
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  const form = document.querySelector(`#${id} form`);
  if (form) form.reset();
}

function editBudgetItem(id) {
  const item = state.budget.find(b => b.id === id);
  if (item) {
    const freq = item.frequency || 'monthly';
    document.getElementById('modal-budget-title').textContent = 'Edit Budget Item';
    document.getElementById('budget-item-id').value = item.id;
    document.getElementById('budget-item-name').value = item.name;
    document.getElementById('budget-item-type').value = item.type;
    document.getElementById('budget-item-frequency').value = freq;
    document.getElementById('budget-item-expected').value = toDisplay(item.expected, freq);
    document.getElementById('budget-item-actual').value = toDisplay(item.actual, freq);
    const hint = document.getElementById('budget-actual-hint');
    if (hint) hint.textContent = item.actualSource === 'transactions'
      ? `Currently derived from ${item.actualTxCount || 0} imported transaction(s). Changing it makes this a manual override.`
      : 'Leave blank to use the expected amount.';
    openModal('modal-add-budget');
  }
}

function deleteBudgetItem(id) {
  if (confirm('Delete this budget item?')) {
    state.budget = state.budget.filter(b => b.id !== id);
    saveToLocalStorage();
    renderAll();
  }
}

function editAssetItem(id) {
  const item = state.assets.find(a => a.id === id);
  if (item) {
    document.getElementById('asset-item-id').value = item.id;
    document.getElementById('asset-name').value = item.name;
    document.getElementById('asset-category').value = item.category;
    document.getElementById('asset-value').value = item.value;
    document.getElementById('asset-yield').value = item.yield;
    openModal('modal-add-asset');
  }
}

function deleteAssetItem(id) {
  if (confirm('Delete this asset?')) {
    state.assets = state.assets.filter(a => a.id !== id);
    saveToLocalStorage();
    renderAll();
  }
}

function editLiabilityItem(id) {
  const item = state.liabilities.find(l => l.id === id);
  if (item) {
    document.getElementById('liability-item-id').value = item.id;
    document.getElementById('liability-name').value = item.name;
    document.getElementById('liability-category').value = item.category;
    document.getElementById('liability-balance').value = item.balance;
    document.getElementById('liability-rate').value = item.rate;
    document.getElementById('liability-payment').value = item.payment > 0 ? item.payment : '';
    document.getElementById('liability-in-budget').checked = item.inBudget !== false;
    updateLiabilityPaymentHint();
    openModal('modal-add-liability');
  }
}

function deleteLiabilityItem(id) {
  if (confirm('Delete this liability?')) {
    state.liabilities = state.liabilities.filter(l => l.id !== id);
    saveToLocalStorage();
    renderAll();
  }
}

// STORAGE & EXPORT
const STORAGE_KEY = 'spendplan_state';
const STORAGE_VERSION = 2;

function persistedSnapshot() {
  return {
    version: STORAGE_VERSION,
    budget: state.budget,
    assets: state.assets,
    liabilities: state.liabilities,
    transactions: state.transactions,
    savedScenarios: state.savedScenarios,
    actualsMonths: state.actualsMonths,
    timeframe: state.timeframe
  };
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSnapshot()));
  } catch (e) {
    console.error('Failed to save state', e);
    notify('Could not save to browser storage (quota or privacy mode).', 'error');
  }
}

// Validate + upgrade a persisted/imported snapshot into state.  Returns false if unusable.
function applySnapshot(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const arr = (v) => Array.isArray(v) ? v : [];
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (parseFloat(v) || d || 0);

  state.budget = arr(parsed.budget).map(Ledger.normalizeBudgetItem).filter(Boolean);
  state.assets = arr(parsed.assets).map(Ledger.normalizeAsset).filter(Boolean);
  state.liabilities = arr(parsed.liabilities).map(Ledger.normalizeLiability).filter(Boolean);

  // Transactions: normalise legacy records (v1 stored raw date strings and no keys).
  const legacy = arr(parsed.transactions).map(t => ({
    id: t.id,
    date: Parse.parseDate(t.date) || null,
    description: String(t.description || ''),
    amount: num(t.amount),
    category: t.category ? String(t.category) : null,
    categoryOverride: t.categoryOverride || undefined,
    account: String(t.account || 'Imported'),
    accountType: t.accountType || 'checking',
    fitid: t.fitid || null,
    source: t.source || 'import',
    key: t.key
  })).filter(t => t.date);
  state.transactions = Ledger.mergeTransactions([], legacy).transactions;

  state.savedScenarios = arr(parsed.savedScenarios).filter(sc => sc && sc.name && sc.config);
  state.actualsMonths = parsed.actualsMonths === 'all' || [1, 3, 6, 12].includes(Number(parsed.actualsMonths)) ? parsed.actualsMonths : 'all';
  if (['monthly', 'annual', '5years', '10years'].includes(parsed.timeframe)) {
    state.timeframe = parsed.timeframe;
    document.getElementById('global-timeframe').value = state.timeframe;
  }

  // Legacy (v1) data derived actuals with the old /12 heuristic: recompute properly.
  if ((parsed.version || 1) < 2 && state.transactions.length) recomputeActuals();
  return true;
}

function loadFromLocalStorage() {
  let data = null;
  try { data = localStorage.getItem(STORAGE_KEY); } catch (e) { console.error(e); }
  if (!data) return false;
  try {
    const ok = applySnapshot(JSON.parse(data));
    if (ok) renderSavedScenariosDropdown();
    return ok;
  } catch (e) {
    console.error('Failed to parse state', e);
    return false;
  }
}

function initDataExportImport() {
  document.getElementById('btn-export-data').addEventListener('click', () => {
    const dataStr = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(persistedSnapshot(), null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `spendplan-backup-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  const fileInput = document.getElementById('json-file-input');
  document.getElementById('btn-import-data').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (!imported || typeof imported !== 'object' || !(imported.budget || imported.assets || imported.transactions)) {
            throw new Error('not a SpendPlan backup');
          }
          if (!confirm('Replace all current data with this backup?')) return;
          applySnapshot(imported);
          renderSavedScenariosDropdown();
          saveToLocalStorage();
          renderAll();
          notify(`Backup restored: ${state.budget.length} budget lines, ${state.transactions.length} transactions.`, 'success');
        } catch (err) {
          notify('That file is not a valid SpendPlan JSON backup.', 'error');
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  });
}
