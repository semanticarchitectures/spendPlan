/**
 * SpendPlan chart rendering (Chart.js integrations).
 *
 * Depends on globals defined in app.js (state, formatCurrency, esc, getTimeMultiplier,
 * runProjection) and on parse.js/ledger.js/projection.js loaded before it. Classic
 * <script> tags share one global scope, so load order relative to app.js does not
 * matter as long as this file loads after Chart.js and before DOMContentLoaded fires.
 */

// Shared styling so every chart stays visually consistent from one place.
const CHART_THEME = {
  tick: '#9ca3af',
  grid: 'rgba(255,255,255,0.05)',
  donutBorder: 'rgba(0,0,0,0.3)'
};

const DONUT_PALETTE = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#a855f7',
  '#ef4444', '#3b82f6', '#84cc16', '#f97316', '#ec4899'
];

let chartBudget = null;
let chartNetWorthForecast = null;
let chartSpendingDonut = null;
let chartAssetDonut = null;
let chartScenario = null;

function renderDashboardCharts() {
  const mult = getTimeMultiplier();
  const expInc = state.budget.filter(i => i.type === 'income').reduce((s, i) => s + i.expected, 0) * mult;
  const actInc = state.budget.filter(i => i.type === 'income').reduce((s, i) => s + i.actual, 0) * mult;

  const expExp = state.budget.filter(i => i.type === 'expense').reduce((s, i) => s + i.expected, 0) * mult;
  const actExp = state.budget.filter(i => i.type === 'expense').reduce((s, i) => s + i.actual, 0) * mult;

  // Chart 1: Income vs Spending
  const ctx1 = document.getElementById('chart-budget-comparison').getContext('2d');
  if (chartBudget) chartBudget.destroy();

  chartBudget = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: ['Income', 'Spending'],
      datasets: [
        {
          label: 'Expected (Planned)',
          data: [expInc, expExp],
          backgroundColor: 'rgba(99, 102, 241, 0.6)',
          borderColor: '#6366f1',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Actual (Imported)',
          data: [actInc, actExp],
          backgroundColor: 'rgba(6, 182, 212, 0.7)',
          borderColor: '#06b6d4',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_THEME.tick, font: { family: 'Plus Jakarta Sans' } } }
      },
      scales: {
        x: { ticks: { color: CHART_THEME.tick }, grid: { color: CHART_THEME.grid } },
        y: { ticks: { color: CHART_THEME.tick }, grid: { color: CHART_THEME.grid } }
      }
    }
  });

  // Chart 2: 5-Year Forecast
  const ctx2 = document.getElementById('chart-networth-forecast').getContext('2d');
  if (chartNetWorthForecast) chartNetWorthForecast.destroy();

  // Same engine as the What-If tab: per-asset yields, amortizing debt, default inflation.
  const forecast = runProjection(Projection.baselineScenario(), 60);
  const labels = forecast.years.map((y, i) => i === 0 ? 'Current' : `Year ${y.year}`);
  const data = forecast.years.map(y => y.netWorth);

  chartNetWorthForecast = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Projected Net Worth',
        data: data,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#10b981'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_THEME.tick } }
      },
      scales: {
        x: { ticks: { color: CHART_THEME.tick }, grid: { color: CHART_THEME.grid } },
        y: { ticks: { color: CHART_THEME.tick }, grid: { color: CHART_THEME.grid } }
      }
    }
  });

  // Chart 3: Spending Breakdown Donut
  renderSpendingDonut();

  // Chart 4: Asset Allocation Donut
  renderAssetDonut();
}

function renderSpendingDonut() {
  const ctx = document.getElementById('chart-spending-donut')?.getContext('2d');
  if (!ctx) return;
  if (chartSpendingDonut) chartSpendingDonut.destroy();

  const expenses = state.budget.filter(i => i.type === 'expense');
  if (expenses.length === 0) return;

  chartSpendingDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: expenses.map(e => String(e.name).split(' ').slice(0,2).join(' ')),
      datasets: [{
        data: expenses.map(e => Math.round(e.actual * 12)),
        backgroundColor: DONUT_PALETTE.slice(0, expenses.length),
        borderColor: CHART_THEME.donutBorder,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: CHART_THEME.tick, boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
          }
        }
      }
    }
  });
}

function renderAssetDonut() {
  const ctx = document.getElementById('chart-asset-donut')?.getContext('2d');
  if (!ctx) return;
  if (chartAssetDonut) chartAssetDonut.destroy();

  if (state.assets.length === 0) return;

  // Group by category
  const catMap = {};
  state.assets.forEach(a => {
    catMap[a.category] = (catMap[a.category] || 0) + Number(a.value);
  });

  chartAssetDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(catMap),
      datasets: [{
        data: Object.values(catMap).map(v => Math.round(v)),
        backgroundColor: DONUT_PALETTE.slice(0, Object.keys(catMap).length),
        borderColor: CHART_THEME.donutBorder,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: CHART_THEME.tick, boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
          }
        }
      }
    }
  });
}

// Payoff timeline list for the scenario tab — not a Chart.js chart, but only ever
// invoked from renderScenarioCharts() as part of the same comparison re-render.
function renderPayoffTimeline(excursion, baseline) {
  const ul = document.getElementById('scen-payoff-list');
  if (!ul) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!excursion.liabilities.length) { ul.innerHTML = '<li class="text-muted">No liabilities.</li>'; return; }
  const baseById = {};
  baseline.liabilities.forEach(l => { baseById[l.id] = l; });
  ul.innerHTML = excursion.liabilities.map(l => {
    const b = baseById[l.id];
    let when;
    if (l.payoffMonth === 0) when = '<span class="text-muted">already paid</span>';
    else if (l.neverPaysOff) when = `<span class="text-danger">not within 10 yrs</span> <span class="text-muted">(${formatCurrency(l.balance)} left)</span>`;
    else when = `<span class="text-success">${esc(Projection.monthLabel(today, l.payoffMonth))}</span>`;
    const note = b && b.payoffMonth !== l.payoffMonth && !(b.neverPaysOff && l.neverPaysOff) ? ` <span class="text-muted">(baseline: ${b.neverPaysOff ? '>10 yrs' : esc(Projection.monthLabel(today, b.payoffMonth))})</span>` : '';
    return `<li><span>${esc(l.name)} <span class="text-muted">${formatCurrency(l.payment)}/mo</span></span><span>${when}${note}</span></li>`;
  }).join('');
}

function renderScenarioCharts() {
  const ctx = document.getElementById('chart-scenario-comparison')?.getContext('2d');
  if (!ctx) return;

  renderReturnSliderLabel();
  const baseline = runProjection(Projection.baselineScenario());
  const excursion = runProjection(state.scenario);
  const labels = baseline.years.map(y => `Yr ${y.year}`);
  const baselineNW = baseline.years.map(y => y.netWorth);
  const excursionNW = excursion.years.map(y => y.netWorth);

  const compareAll = document.getElementById('toggle-compare-all')?.checked;

  const datasets = [
    {
      label: 'Baseline',
      data: baselineNW,
      borderColor: '#9ca3af',
      borderDash: [5, 5],
      backgroundColor: 'transparent',
      tension: 0.3,
      pointRadius: 3
    },
    {
      label: state.activeSavedScenarioId
        ? (state.savedScenarios.find(s => s.id === state.activeSavedScenarioId)?.name || 'Active Scenario')
        : 'Active Sandbox',
      data: excursionNW,
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.12)',
      fill: true,
      tension: 0.3,
      pointBackgroundColor: '#06b6d4',
      borderWidth: 2
    }
  ];

  // Add all saved scenarios as additional lines when compare-all is on
  if (compareAll && state.savedScenarios.length > 0) {
    const COMPARE_COLORS = ['#a855f7', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];
    state.savedScenarios.forEach((scen, i) => {
      if (scen.id === state.activeSavedScenarioId) return; // skip active (already drawn)
      const traj = runProjection(scen.config).years.map(y => y.netWorth);
      datasets.push({
        label: scen.name,
        data: traj,
        borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 1.5
      });
    });
  }

  if (chartScenario) chartScenario.destroy();

  chartScenario = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: CHART_THEME.tick, usePointStyle: true, pointStyleWidth: 8 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { color: CHART_THEME.tick }, grid: { color: CHART_THEME.grid } },
        y: {
          ticks: {
            color: CHART_THEME.tick,
            callback: (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 0 }).format(v)
          },
          grid: { color: CHART_THEME.grid }
        }
      }
    }
  });

  // Update stats panel
  const finalDiff = excursionNW[10] - baselineNW[10];
  document.getElementById('scen-baseline-nw').textContent = formatCurrency(baselineNW[10]);
  document.getElementById('scen-excursion-nw').textContent = formatCurrency(excursionNW[10]);

  const sum = excursion.summary;
  const scenAnnualCashFlow = sum.year1Surplus;
  const scenSavingsRate = sum.year1Income > 0 ? Math.round((scenAnnualCashFlow / sum.year1Income) * 100) : 0;
  const investGrowth10 = sum.investGrowth;

  document.getElementById('scen-annual-cashflow').textContent = formatCurrency(scenAnnualCashFlow);
  document.getElementById('scen-annual-cashflow').className = `sub-stat-val ${scenAnnualCashFlow >= 0 ? 'text-success' : 'text-danger'}`;

  document.getElementById('scen-savings-rate').textContent = `${scenSavingsRate}%`;
  document.getElementById('scen-savings-rate').className = `sub-stat-val ${scenSavingsRate >= 15 ? 'text-success' : scenSavingsRate >= 0 ? 'font-accent' : 'text-danger'}`;

  document.getElementById('scen-invest-growth').textContent = formatCurrency(investGrowth10);
  document.getElementById('scen-nw-delta').textContent = `${finalDiff >= 0 ? '+' : ''}${formatCurrency(finalDiff)}`;
  document.getElementById('scen-nw-delta').className = `sub-stat-val ${finalDiff >= 0 ? 'text-success' : 'text-danger'}`;

  const interestEl = document.getElementById('scen-interest-paid');
  if (interestEl) {
    interestEl.textContent = formatCurrency(sum.totalInterest);
    interestEl.title = `Baseline: ${formatCurrency(baseline.summary.totalInterest)}`;
  }
  renderPayoffTimeline(excursion, baseline);

  const cashWarn = document.getElementById('scen-cash-warning');
  if (cashWarn) cashWarn.style.display = sum.cashWentNegative ? 'block' : 'none';

  const badge = document.getElementById('trajectory-delta-badge');
  badge.textContent = `${finalDiff >= 0 ? '+' : ''}${formatCurrency(finalDiff)} vs Baseline`;
  badge.className = `trajectory-delta badge ${finalDiff >= 0 ? 'badge-success' : 'badge-danger'}`;

  // Notes panel
  const notesPanel = document.getElementById('scenario-notes-panel');
  const notesText = document.getElementById('scenario-notes-text');
  if (state.activeSavedScenarioId) {
    const activeSc = state.savedScenarios.find(s => s.id === state.activeSavedScenarioId);
    if (activeSc?.notes) {
      notesText.textContent = activeSc.notes;
      notesPanel.style.display = 'block';
    } else {
      notesPanel.style.display = 'none';
    }
  } else {
    notesPanel.style.display = 'none';
  }
}
