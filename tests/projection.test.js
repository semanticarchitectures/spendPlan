const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../projection.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol ?? 0.5), `${msg || ''} expected ≈${b}, got ${a}`);

test('loanPayment: textbook values', () => {
  near(P.loanPayment(100000, 6, 360), 599.55, 0.01);
  near(P.loanPayment(340000, 3.8, 360), 1584.25, 0.05);
  assert.equal(P.loanPayment(12000, 0, 12), 1000);
  assert.equal(P.loanPayment(0, 5, 60), 0);
});

test('liabilityPayment: explicit wins, else estimated from category term', () => {
  assert.equal(P.liabilityPayment({ balance: 10000, rate: 5, category: 'Auto Loan', payment: 250 }), 250);
  near(P.liabilityPayment({ balance: 10000, rate: 0, category: 'Auto Loan' }), 10000 / 60, 0.01);
  assert.equal(P.isPaymentEstimated({ payment: null }), true);
  assert.equal(P.isPaymentEstimated({ payment: 100 }), false);
});

test('amortizationSchedule: zero-rate, payoff month, total interest, never pays off', () => {
  const s = P.amortizationSchedule({ balance: 10000, rate: 0, category: 'Auto Loan', payment: 1000 });
  assert.equal(s.payoffMonth, 10);
  assert.equal(s.totalInterest, 0);
  const m = P.amortizationSchedule({ balance: 100000, rate: 6, category: 'Mortgage', payment: P.loanPayment(100000, 6, 360) });
  assert.equal(m.payoffMonth, 360);
  near(m.totalInterest, 115838, 20);
  const cc = P.amortizationSchedule({ balance: 5000, rate: 24, category: 'Credit Card', payment: 50 }, 120);
  assert.equal(cc.neverPaysOff, true);
  assert.equal(cc.rows.length, 120);
});

const budget = (income, expense) => [
  { id: 'i', name: 'Salary', type: 'income', expected: income, actual: income },
  { id: 'e', name: 'Housing', type: 'expense', expected: expense, actual: expense }
];
const NOINF = { inflationRate: 0 };

test('project: net-worth identity with a 0% budgeted loan (ΔNW = income − non-debt expenses)', () => {
  const r = P.project({
    budget: budget(1000, 500), assets: [],
    liabilities: [{ id: 'l', name: 'Car', category: 'Auto Loan', balance: 10000, rate: 0, payment: 500, inBudget: true }],
    scenario: NOINF, months: 12
  });
  assert.equal(r.years[0].netWorth, -10000);
  assert.equal(r.years[1].netWorth, 2000);
  assert.equal(r.summary.year1Surplus, 6000);
  assert.equal(r.summary.year1DebtPayments, 6000);
});

test('project: interest is the only cost of debt; payoff frees the payment', () => {
  // 3000 @ 0%, payment 500 → paid off month 6; then surplus jumps to 1000
  const r = P.project({
    budget: budget(1000, 500), assets: [],
    liabilities: [{ id: 'l', name: 'Car', category: 'Auto Loan', balance: 3000, rate: 0, payment: 500, inBudget: true }],
    scenario: NOINF, months: 12
  });
  assert.equal(r.liabilities[0].payoffMonth, 6);
  assert.equal(r.years[1].netWorth, -3000 + 12000);
  assert.equal(r.years[1].liabilities, 0);
  near(r.years[1].annualSurplus, 6 * 500 + 6 * 1000, 0.01);

  // with 12% APR the NW shortfall vs the 0% case equals total interest
  const r2 = P.project({
    budget: budget(1000, 500), assets: [],
    liabilities: [{ id: 'l', name: 'Car', category: 'Auto Loan', balance: 3000, rate: 12, payment: 500, inBudget: true }],
    scenario: NOINF, months: 12
  });
  near(r.years[1].netWorth - r2.years[1].netWorth, r2.summary.totalInterest, 1);
});

test('project: unbudgeted loan payment is an extra outflow', () => {
  const a = P.project({ budget: budget(1000, 500), assets: [], liabilities: [{ id: 'l', name: 'X', category: 'Auto Loan', balance: 100000, rate: 0, payment: 200, inBudget: false }], scenario: NOINF, months: 12 });
  const b = P.project({ budget: budget(1000, 500), assets: [], liabilities: [{ id: 'l', name: 'X', category: 'Auto Loan', balance: 100000, rate: 0, payment: 200, inBudget: true }], scenario: NOINF, months: 12 });
  // unbudgeted: surplus 300/mo ; budgeted: the 500 expense already contains the 200, surplus 500/mo
  assert.equal(a.summary.year1Surplus, 3600);
  assert.equal(b.summary.year1Surplus, 6000);
});

test('project: assets compound at their own yields; override touches only investable', () => {
  const assets = [
    { id: 'c', name: 'HYSA', category: 'Cash / Liquid', value: 10000, yield: 4.5 },
    { id: 'k', name: '401k', category: 'Retirement', value: 10000, yield: 12 },
    { id: 'h', name: 'Home', category: 'Real Estate', value: 100000, yield: 3 }
  ];
  const r = P.project({ budget: [], assets, liabilities: [], scenario: NOINF, months: 12 });
  near(r.years[1].cash, 10450, 1);
  near(r.years[1].investable, 11200, 1);
  near(r.years[1].realEstate, 103000, 1);
  const o = P.project({ budget: [], assets, liabilities: [], scenario: { inflationRate: 0, returnRate: 0 }, months: 12 });
  near(o.years[1].investable, 10000, 1);
  near(o.years[1].cash, 10450, 1);
  assert.equal(o.summary.investGrowth, 0);
});

test('project: surplus goes to investments at the investable yield; contributions counted', () => {
  const assets = [{ id: 'k', name: '401k', category: 'Retirement', value: 0, yield: 12 }];
  const r = P.project({ budget: budget(1000, 0), assets, liabilities: [], scenario: NOINF, months: 12 });
  assert.equal(r.summary.contributions, 12000);
  assert.ok(r.years[1].investable > 12000 && r.years[1].investable < 12800, String(r.years[1].investable));
  assert.equal(r.summary.investYieldUsed, 12);
});

test('project: deficits drain cash first, then investments, then flag negative', () => {
  const assets = [
    { id: 'c', name: 'Cash', category: 'Cash / Liquid', value: 1000, yield: 0 },
    { id: 'k', name: 'Inv', category: 'Retirement', value: 1000, yield: 0 }
  ];
  const r = P.project({ budget: budget(0, 300), assets, liabilities: [], scenario: NOINF, months: 12 });
  // 3600 out over the year, 2000 available → NW -1600
  assert.equal(r.years[1].netWorth, -1600);
  assert.equal(r.years[1].cash, 0);
  assert.equal(r.summary.cashWentNegative, true);
  const ok = P.project({ budget: budget(0, 100), assets, liabilities: [], scenario: NOINF, months: 12 });
  assert.equal(ok.years[1].cash, 0);      // 1200 out: cash 1000 gone, then 200 from investments
  assert.equal(ok.years[1].investable, 800);
  assert.equal(ok.summary.cashWentNegative, false);
});

test('project: inflation raises income and non-debt expenses but not loan payments', () => {
  const r = P.project({
    budget: budget(1000, 1000),
    assets: [], liabilities: [{ id: 'l', name: 'M', category: 'Mortgage', balance: 100000, rate: 0, payment: 500, inBudget: true }],
    scenario: { inflationRate: 12 }, months: 12
  });
  // income inflates: sum over year > 12000; expenses = 500 fixed + 500 inflating
  assert.ok(r.summary.year1Income > 12000 && r.summary.year1Income < 12800, String(r.summary.year1Income));
  assert.equal(r.summary.year1DebtPayments, 6000);
  assert.ok(r.summary.year1Expenses > 12000 && r.summary.year1Expenses < 12400, String(r.summary.year1Expenses));
});

test('project: one-off hits at month 1 and income/spending steps apply', () => {
  const base = P.project({ budget: budget(1000, 500), assets: [], liabilities: [], scenario: NOINF, months: 12 });
  const one = P.project({ budget: budget(1000, 500), assets: [], liabilities: [], scenario: { inflationRate: 0, oneOffs: [{ desc: 'car', amount: -2000 }] }, months: 12 });
  assert.equal(base.years[1].netWorth - one.years[1].netWorth, 2000);
  assert.equal(one.summary.year1Surplus, base.summary.year1Surplus); // one-offs are not "cash flow"
  assert.equal(one.summary.oneOffTotal, -2000);
  const up = P.project({ budget: budget(1000, 500), assets: [], liabilities: [], scenario: { inflationRate: 0, incomeChange: 10, spendingChange: -20 }, months: 12 });
  assert.equal(up.summary.year1Surplus, 12 * (1100 - 400));
});

test('project: baseline scenario is stable and 10-year default horizon yields 11 points', () => {
  const r = P.project({ budget: budget(5000, 3000), assets: [{ id: 'k', name: 'k', category: 'Retirement', value: 50000, yield: 7 }], liabilities: [], scenario: P.baselineScenario() });
  assert.equal(r.years.length, 11);
  assert.equal(r.years[10].year, 10);
  assert.ok(r.years[10].netWorth > r.years[0].netWorth);
});

test('monthLabel', () => {
  assert.equal(P.monthLabel('2026-09-07', 0), 'Sep 2026');
  assert.equal(P.monthLabel('2026-09-07', 4), 'Jan 2027');
  assert.equal(P.monthLabel('2026-09-07', 360), 'Sep 2056');
});

test('project: investable-targeted one-off scales investments, leaves cash alone', () => {
  const assets = [
    { id: 'c', name: 'Cash', category: 'Cash / Liquid', value: 10000, yield: 0 },
    { id: 'k', name: 'Inv', category: 'Retirement', value: 50000, yield: 0 },
    { id: 'b', name: 'Brk', category: 'Investment / Stocks', value: 30000, yield: 0 }
  ];
  const r = P.project({ budget: [], assets, liabilities: [], scenario: { inflationRate: 0, oneOffs: [{ desc: 'crash', amount: -16000, target: 'investable' }] }, months: 12 });
  assert.equal(r.years[1].cash, 10000);
  assert.equal(r.years[1].investable, 64000);
  assert.equal(r.years[1].netWorth, 74000);
});
