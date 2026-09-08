// End-to-end smoke test: loads the app in headless Chromium, checks the demo
// numbers, then imports four fixture statements and checks the derived actuals.
// Run: node tests/e2e.js   (needs playwright + chromium available)
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FX = path.join(__dirname, 'fixtures');
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // The sandbox has no CDN access; stub Chart.js if it fails to load so the
  // rest of the app can be exercised.  (In a real browser the CDN copy loads.)
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      if (typeof window.Chart === 'undefined') window.Chart = class { constructor() {} destroy() {} update() {} };
    }, { capture: true });
  });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(800);

  const text = (sel) => page.locator(sel).innerText();

  // ---- Demo data sanity ----
  check('no JS errors on load', errors.length === 0, errors.join(' | '));
  const expSpend = await text('#dash-expected-spending');
  const expInc = await text('#dash-expected-income');
  const cash = await text('#quick-cash-flow');
  check('demo expected spending is monthly-normalised (annual view)', expSpend === '$72,600', expSpend);
  check('demo expected income', expInc === '$109,200', expInc);
  check('demo net cash flow positive', cash.startsWith('$') && !cash.startsWith('-'), cash);
  const savings = await text('#val-savings-rate');
  check('demo savings rate sane', parseInt(savings) > 0 && parseInt(savings) < 60, savings);

  // ---- Edit form shows annual figures for annual lines ----
  await page.click('.nav-item[data-tab="budget"]');
  await page.click('button[data-action="edit-budget"][data-id="b9"]');
  const freq = await page.inputValue('#budget-item-frequency');
  const expVal = await page.inputValue('#budget-item-expected');
  check('edit form restores frequency + annual value', freq === 'annual' && expVal === '6000', `${freq} ${expVal}`);
  // set an explicit $0 actual and save → must stay 0
  await page.fill('#budget-item-actual', '0');
  await page.click('#form-budget button[type=submit]');
  await page.waitForTimeout(200);
  const rowB9 = await page.locator('#tbody-budget tr', { hasText: 'Vacation' }).innerText();
  check('actual of $0 is kept (annual view shows $0)', /\$0\s+manual/i.test(rowB9.replace(/\n/g, ' ')), rowB9.replace(/\n/g, ' '));

  // ---- Import 1: Chase checking CSV ----
  async function importFile(file, opts = {}) {
    await page.click('.nav-item[data-tab="importer"]');
    await page.setInputFiles('#statement-file-input', path.join(FX, file));
    await page.waitForSelector('#importer-preview-card', { state: 'visible' });
    await page.waitForTimeout(200);
    if (opts.before) await opts.before();
    const summary = await text('#import-parse-summary');
    const btn = await text('#btn-process-import');
    await page.click('#btn-process-import');
    await page.waitForTimeout(400);
    return { summary, btn };
  }

  let r = await importFile('chase_checking.csv');
  check('chase: all rows parse', r.summary.startsWith('8 of 8 rows'), r.summary);
  check('chase: button offers 8', r.btn.includes('8'), r.btn);
  const info1 = await text('#actuals-period-info');
  check('actuals: 1 complete month (Sep excluded), transfers excluded', /over 1 complete month/.test(info1) && /Transfers/.test(info1) && /current month is excluded/.test(info1), info1);
  const salaryRow = (await page.locator('#tbody-budget tr', { hasText: 'Primary Salary' }).innerText()).replace(/\n/g, ' ');
  check('salary actual = $8,500/mo → $102,000 annual, imported', /\$102,000\s+imported/i.test(salaryRow), salaryRow);
  const housingRow = (await page.locator('#tbody-budget tr', { hasText: 'Housing' }).innerText()).replace(/\n/g, ' ');
  check('housing actual = $2,800/mo (mortgage autopay not a transfer)', /\$33,600\s+imported/i.test(housingRow), housingRow);
  const utilRow = (await page.locator('#tbody-budget tr', { hasText: 'Utilities' }).innerText()).replace(/\n/g, ' ');
  check('utilities actual = $330/mo', /\$3,960\s+imported/i.test(utilRow), utilRow);

  // ---- Import 1 again: dedupe ----
  r = await importFile('chase_checking.csv');
  check('chase re-import: all flagged as already imported', /8 already imported/.test(r.summary), r.summary);
  const nTx1 = await page.evaluate(() => state.transactions.length);
  check('transaction count unchanged after re-import', nTx1 === 4 + 8, String(nTx1));

  // ---- Import 2: Amex card (positive = charge) ----
  r = await importFile('amex_card.csv', {
    before: async () => {
      const type = await page.inputValue('#map-account-type');
      const invert = await page.isChecked('#map-invert');
      check('amex: detected as credit card with invert suggested', type === 'credit' && invert, `${type} invert=${invert}`);
    }
  });
  check('amex: quoted "1,120.20" parsed', /8 of 8 rows/.test(r.summary), r.summary);
  const groceryRow = (await page.locator('#tbody-budget tr', { hasText: 'Groceries' }).innerText()).replace(/\n/g, ' ');
  // 245.50 + 1120.20 = 1365.70 /mo → 16,388 annual
  check('groceries actual from Amex charges = $16,388 annual', /\$16,388\s+imported/i.test(groceryRow), groceryRow);
  const diningRow = (await page.locator('#tbody-budget tr', { hasText: 'Dining' }).innerText()).replace(/\n/g, ' ');
  // 6.75 + 15.99 + 14.20 = 36.94 → 443 annual
  check('dining+entertainment actual = $443 annual', /\$443\s+imported/i.test(diningRow), diningRow);
  const payment = await page.evaluate(() => state.transactions.find(t => /THANK YOU/.test(t.description)));
  check('amex payment inverted to +1450 and treated as transfer', payment && payment.amount === 1450, JSON.stringify(payment && payment.amount));
  const shell = await page.evaluate(() => state.transactions.find(t => /SHELL OIL/.test(t.description)));
  check('amex charge inverted to negative', shell && shell.amount === -62.1, JSON.stringify(shell && shell.amount));

  // ---- Import 3: Capital One split debit/credit ----
  r = await importFile('capone_split.csv', {
    before: async () => {
      const amt = await page.inputValue('#map-amount-col');
      const deb = await page.inputValue('#map-debit-col');
      const cred = await page.inputValue('#map-credit-col');
      check('capone: debit/credit columns auto-mapped', amt === '-1' && deb === '5' && cred === '6', `amount=${amt} debit=${deb} credit=${cred}`);
    }
  });
  check('capone: 4 rows parse', /4 of 4 rows/.test(r.summary), r.summary);
  const kroger = await page.evaluate(() => state.transactions.find(t => /KROGER/.test(t.description)));
  check('capone debit → negative', kroger && kroger.amount === -88.31, JSON.stringify(kroger && kroger.amount));
  const pymt = await page.evaluate(() => { const t = state.transactions.find(t => /ONLINE PYMT/.test(t.description)); return t && [t.amount, SpendPlanLedger.isTransfer(t)]; });
  check('capone credit payment → +500, transfer', pymt && pymt[0] === 500 && pymt[1] === true, JSON.stringify(pymt));

  // ---- Import 4: OFX July → window now 2 months ----
  r = await importFile('demo.qfx', {
    before: async () => {
      const acct = await page.inputValue('#map-account-label');
      const fit = await page.inputValue('#map-fitid-col');
      check('ofx: account label + FITID column mapped', /4321/.test(acct) && fit === '4', `${acct} fitid=${fit}`);
    }
  });
  check('ofx: 4 rows parse', /4 of 4 rows/.test(r.summary), r.summary);
  const info2 = await text('#actuals-period-info');
  check('actuals window now spans Jul–Aug (2 complete months)', /over 2 complete months/.test(info2) && /Jul 2026 – Aug 2026/.test(info2), info2);
  const salaryRow2 = (await page.locator('#tbody-budget tr', { hasText: 'Primary Salary' }).innerText()).replace(/\n/g, ' ');
  check('salary still $8,500/mo across Jul+Aug', /\$102,000\s+imported/i.test(salaryRow2), salaryRow2);
  // Switch to last-month window
  const activeTab = await page.evaluate(() => document.querySelector('.tab-pane.active').id);
  check('landed on budget tab after import', activeTab === 'tab-budget', activeTab);
  await page.selectOption('#actuals-months', '1');
  await page.waitForTimeout(300);
  const info3 = await text('#actuals-period-info');
  check('last-month window applied', /over 1 complete month/.test(info3) && /Aug 2026 – Aug 2026/.test(info3), info3);

  // ---- Persistence round trip ----
  await page.reload();
  await page.waitForTimeout(800);
  const nTx2 = await page.evaluate(() => state.transactions.length);
  const months = await page.evaluate(() => state.actualsMonths);
  check('state persists across reload', nTx2 === 4 + 8 + 8 + 4 + 4 && months === 1, `${nTx2} ${months}`);

  // ---- XSS: a hostile description must render as text ----
  await page.evaluate(() => {
    state.transactions.push({ id: 'x', key: 'x', date: '2026-09-06', description: '<img src=x onerror="window.__pwned=1">', amount: -1, account: '<b>acct</b>', accountType: 'checking', category: null, fitid: null, source: 'test' });
    renderAll();
  });
  await page.waitForTimeout(200);
  const pwned = await page.evaluate(() => window.__pwned === 1);
  const rendered = await page.locator('#tbody-recent-txs').innerText();
  check('hostile description escaped', !pwned && rendered.includes('<img src=x'), pwned ? 'EXECUTED' : 'ok');

  // ---- Legacy v1 localStorage migration ----
  await page.evaluate(() => {
    localStorage.setItem('spendplan_state', JSON.stringify({
      budget: [{ id: 'b1', name: 'Salary', type: 'income', expected: 5000, actual: 100, frequency: 'monthly' }],
      assets: [], liabilities: [],
      transactions: [{ id: 't1', date: '08/01/2026', account: 'Old', description: 'PAYROLL', category: 'Salary', amount: 5000, type: 'income' }],
      savedScenarios: []
    }));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const migrated = await page.evaluate(() => ({ date: state.transactions[0].date, key: !!state.transactions[0].key, actual: state.budget[0].actual, src: state.budget[0].actualSource }));
  check('v1 data migrated: ISO date, key assigned, actual recomputed', migrated.date === '2026-08-01' && migrated.key && migrated.actual === 5000 && migrated.src === 'transactions', JSON.stringify(migrated));

  // ---- Projection engine wiring ----
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('.nav-item[data-tab="networth"]');
  const mortgageRow = (await page.locator('#tbody-liabilities tr', { hasText: 'Mortgage' }).innerText()).replace(/\n/g, ' ');
  check('liabilities table shows payment + payoff', /\$1,585/.test(mortgageRow) && /\(\d+ yrs\)/.test(mortgageRow), mortgageRow);
  const ccRow = (await page.locator('#tbody-liabilities tr', { hasText: 'Sapphire' }).innerText()).replace(/\n/g, ' ');
  check('credit card flagged not-in-budget, pays off in months', /not in budget/i.test(ccRow) && /\(\d+ mo\)/.test(ccRow), ccRow);

  // add a liability with a blank payment → estimated
  await page.click('button[onclick="openModal(\'modal-add-liability\')"]');
  await page.fill('#liability-name', 'Student Loan');
  await page.selectOption('#liability-category', 'Student Loan');
  await page.fill('#liability-balance', '24000');
  await page.fill('#liability-rate', '6');
  const hint = await text('#liability-payment-hint');
  check('payment hint shows 10-yr estimate', /\$266\/mo/.test(hint) && /10-year/.test(hint), hint);
  await page.click('#form-liability button[type=submit]');
  await page.waitForTimeout(200);
  const slRow = (await page.locator('#tbody-liabilities tr', { hasText: 'Student Loan' }).innerText()).replace(/\n/g, ' ');
  check('estimated payment tagged est.', /\$266\s+EST\./i.test(slRow), slRow);

  await page.click('.nav-item[data-tab="scenarios"]');
  await page.waitForTimeout(300);
  const retLabel = await text('#val-scen-return');
  check('return slider defaults to per-asset average', /^8(\.\d)?% \(per-asset\)/.test(retLabel), retLabel);
  const delta0 = await text('#scen-nw-delta');
  check('untouched sandbox equals baseline', delta0 === '+$0', delta0);
  const interest = await text('#scen-interest-paid');
  check('interest paid populated', /\$\d{2,3},\d{3}/.test(interest), interest);
  const payoffs = await text('#scen-payoff-list');
  check('payoff timeline lists all liabilities', /Mortgage/.test(payoffs) && /Tesla/.test(payoffs) && /Sapphire/.test(payoffs) && /Student Loan/.test(payoffs), payoffs.replace(/\n/g, ' | '));
  const payoffFlat = payoffs.replace(/\s+/g, ' ');
  check('mortgage not paid within 10 yrs, car loan is', /Mortgage[^|]*?not within 10 yrs/.test(payoffFlat) && /Tesla[^|]*?20\d\d/.test(payoffFlat), payoffFlat);

  // engine consistency: dashboard year-5 equals scenario baseline year-5
  const consistency = await page.evaluate(() => {
    const dash = runProjection(SpendPlanProjection.baselineScenario(), 60).years[5].netWorth;
    const scen = runProjection(SpendPlanProjection.baselineScenario()).years[5].netWorth;
    return [dash, scen];
  });
  check('dashboard 5-yr forecast == scenario baseline yr 5', consistency[0] === consistency[1], consistency.join(' vs '));

  // market correction preset → one-off of 20% of investable (255k → 51k)
  await page.click('button[onclick="applyScenarioPreset(\'marketCrash\')"]');
  await page.waitForTimeout(300);
  const oneOff = await text('#one-off-list');
  check('market correction is a one-off of −$51,000', /51,000/.test(oneOff), oneOff);
  const deltaCrash = await text('#scen-nw-delta');
  check('correction lowers 10-yr net worth', deltaCrash.startsWith('-$'), deltaCrash);

  // override return then revert to per-asset
  await page.fill('#slider-scen-return', '0'); // range inputs: use evaluate to dispatch
  await page.evaluate(() => { const s = document.getElementById('slider-scen-return'); s.value = 0; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(200);
  check('override label', /0% \(override\)/.test(await text('#val-scen-return')), await text('#val-scen-return'));
  await page.click('#btn-scen-return-auto');
  await page.waitForTimeout(200);
  check('back to per-asset', /per-asset/.test(await text('#val-scen-return')), await text('#val-scen-return'));
  await page.click('button[onclick="resetScenario()"]');
  await page.waitForTimeout(300);
  check('reset returns delta to $0', (await text('#scen-nw-delta')) === '+$0', await text('#scen-nw-delta'));

  // legacy saved scenario with numeric returnRate still loads as an override
  await page.evaluate(() => {
    state.savedScenarios.push({ id: 'legacy', name: 'Legacy 7%', notes: '', config: { incomeChange: 0, spendingChange: 0, returnRate: 7, inflationRate: 3, oneOffs: [] } });
    renderSavedScenariosDropdown();
  });
  await page.selectOption('#saved-scenarios-select', 'legacy');
  await page.waitForTimeout(300);
  check('legacy scenario loads returnRate as override', /7% \(override\)/.test(await text('#val-scen-return')), await text('#val-scen-return'));

  check('no JS errors during whole run', errors.length === 0, errors.join(' | '));

  await page.screenshot({ path: path.join(__dirname, 'screenshot-budget.png'), fullPage: false });
  await browser.close();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
