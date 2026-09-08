const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../ledger.js');

const tx = (over) => Object.assign({
  date: '2026-08-15', description: 'X', amount: -10, category: null, account: 'Chase Checking', accountType: 'checking', fitid: null
}, over);

// ---------- dedupe ----------
test('mergeTransactions: re-importing the same file adds nothing', () => {
  const batch = [tx({ description: 'Whole Foods', amount: -45.2 }), tx({ description: 'Payroll', amount: 4250 })];
  const first = L.mergeTransactions([], batch);
  assert.equal(first.added.length, 2);
  assert.ok(first.transactions[0].id && first.transactions[0].key);
  const second = L.mergeTransactions(first.transactions, batch);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(second.transactions.length, 2);
});

test('mergeTransactions: identical legit duplicates within one statement are kept', () => {
  const batch = [tx({ description: 'Starbucks', amount: -5 }), tx({ description: 'Starbucks', amount: -5 })];
  const r = L.mergeTransactions([], batch);
  assert.equal(r.added.length, 2);
  // and re-importing keeps the count at 2, not 3 or 4
  const r2 = L.mergeTransactions(r.transactions, batch);
  assert.equal(r2.transactions.length, 2);
});

test('mergeTransactions: FITID wins over description differences', () => {
  const a = tx({ fitid: 'F1', description: 'WHOLE FOODS #123' });
  const b = tx({ fitid: 'F1', description: 'WHOLE FOODS MARKET' });
  const r = L.mergeTransactions(L.mergeTransactions([], [a]).transactions, [b]);
  assert.equal(r.transactions.length, 1);
});

test('mergeTransactions: same tx on different accounts is not a dup', () => {
  const a = tx({ account: 'Checking' }), b = tx({ account: 'Savings' });
  assert.equal(L.mergeTransactions([], [a, b]).added.length, 2);
});

// ---------- categorize ----------
test('categorize: keyword rules, sign awareness, transfers', () => {
  assert.equal(L.categorize(tx({ description: 'TECH CORP PAYROLL PPD ID: 123', amount: 4250 })), 'Salary');
  assert.equal(L.categorize(tx({ description: 'WHOLE FOODS MARKET #10', amount: -80 })), 'Groceries');
  assert.equal(L.categorize(tx({ description: 'WELLS FARGO MTG AUTOPAY', amount: -2800 })), 'Housing');
  assert.equal(L.categorize(tx({ description: 'CHASE CREDIT CRD AUTOPAY', amount: -1450 })), L.TRANSFER);
  assert.equal(L.categorize(tx({ description: 'AUTOMATIC PAYMENT - THANK YOU', amount: 1450 })), L.TRANSFER);
  assert.equal(L.categorize(tx({ description: 'INTEREST CHARGE ON PURCHASES', amount: -23.1 })), 'Fees');
  assert.equal(L.categorize(tx({ description: 'INTEREST PAYMENT', amount: 1.05 })), 'Dividends');
  assert.equal(L.categorize(tx({ description: 'UNITED HEALTHCARE PREMIUM', amount: -300 })), 'Health');
  assert.equal(L.categorize(tx({ description: 'DELTA DENTAL', amount: -40 })), 'Health');
  assert.equal(L.categorize(tx({ description: 'STOCK MARKET NEWS SUBSCRIPTION', amount: -10 })), null);
  assert.equal(L.categorize(tx({ description: 'AMAZON.COM*AB12', amount: -30 })), 'Shopping');
  assert.equal(L.categorize(tx({ description: 'NETFLIX.COM', amount: -15 })), 'Entertainment');
  assert.equal(L.categorize(tx({ description: 'UNITED AIRLINES', amount: -400 })), 'Vacation');
});

test('categorize: bank-supplied category via aliases, override wins', () => {
  assert.equal(L.categorize(tx({ description: 'ZZZ', category: 'Food & Drink' })), 'Dining');
  assert.equal(L.categorize(tx({ description: 'ZZZ', category: 'Gas' })), 'Auto');
  assert.equal(L.categorize(tx({ description: 'ZZZ', category: 'Pets' })), 'Pets');
  assert.equal(L.categorize(tx({ description: 'WHOLE FOODS', categoryOverride: 'Dining' })), 'Dining');
});

// ---------- matchBudgetItem ----------
const BUDGET = [
  { id: 'b1', name: 'Primary Salary / Tech Corp', type: 'income', expected: 8500, actual: 8500 },
  { id: 'b2', name: 'Dividends & Investments', type: 'income', expected: 600, actual: 600 },
  { id: 'b3', name: 'Housing / Mortgage Payment', type: 'expense', expected: 2800, actual: 2800 },
  { id: 'b4', name: 'Groceries & Household', type: 'expense', expected: 900, actual: 900 },
  { id: 'b5', name: 'Utilities & Internet', type: 'expense', expected: 350, actual: 350 },
  { id: 'b6', name: 'Dining & Entertainment', type: 'expense', expected: 600, actual: 600 },
  { id: 'b7', name: 'Car Insurance & Gas', type: 'expense', expected: 400, actual: 400 },
  { id: 'b8', name: 'Health & Personal Care', type: 'expense', expected: 300, actual: 300 },
  { id: 'b9', name: 'Vacation & Travel', type: 'expense', expected: 500, actual: 500 },
  { id: 'b10', name: 'Clothing & Personal', type: 'expense', expected: 200, actual: 200 },
  { id: 'b11', name: 'Kids', type: 'expense', expected: 200, actual: 200, categories: ['Childcare', 'Education'] }
];

test('matchBudgetItem: synonyms, type filter, explicit categories', () => {
  assert.equal(L.matchBudgetItem(BUDGET, 'Salary', 'in').id, 'b1');
  assert.equal(L.matchBudgetItem(BUDGET, 'Dividends', 'in').id, 'b2');
  assert.equal(L.matchBudgetItem(BUDGET, 'Housing', 'out').id, 'b3');
  assert.equal(L.matchBudgetItem(BUDGET, 'Groceries', 'out').id, 'b4');
  assert.equal(L.matchBudgetItem(BUDGET, 'Utilities', 'out').id, 'b5');
  assert.equal(L.matchBudgetItem(BUDGET, 'Dining', 'out').id, 'b6');
  assert.equal(L.matchBudgetItem(BUDGET, 'Entertainment', 'out').id, 'b6');
  assert.equal(L.matchBudgetItem(BUDGET, 'Auto', 'out').id, 'b7');
  assert.equal(L.matchBudgetItem(BUDGET, 'Health', 'out').id, 'b8');
  assert.equal(L.matchBudgetItem(BUDGET, 'Vacation', 'out').id, 'b9');
  assert.equal(L.matchBudgetItem(BUDGET, 'Shopping', 'out').id, 'b10');
  assert.equal(L.matchBudgetItem(BUDGET, 'Childcare', 'out').id, 'b11');
  assert.equal(L.matchBudgetItem(BUDGET, 'Salary', 'out'), null); // wrong sign → no expense match
  assert.equal(L.matchBudgetItem(BUDGET, 'Pets', 'out'), null);
});

// ---------- periods ----------
test('periodFromTransactions / lastNMonthsPeriod / monthsBetween', () => {
  const txs = [tx({ date: '2026-06-20' }), tx({ date: '2026-08-03' }), tx({ date: '2026-07-11' })];
  const T = { today: '2026-09-07' };
  assert.deepEqual(L.periodFromTransactions(txs, T), { start: '2026-06-01', end: '2026-08-31' });
  assert.equal(L.monthsBetween('2026-06-01', '2026-08-31'), 3);
  assert.deepEqual(L.lastNMonthsPeriod(txs, 1, T), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(L.lastNMonthsPeriod(txs, 12, T), { start: '2026-06-01', end: '2026-08-31' }); // clamps to data
  assert.equal(L.periodFromTransactions([]), null);
  assert.equal(L.monthsBetween('2025-11-01', '2026-02-28'), 4);
});

// ---------- computeActuals ----------
test('computeActuals: one month statement is not divided by 12; transfers excluded', () => {
  const txs = [
    tx({ date: '2026-08-01', description: 'TECH CORP PAYROLL', amount: 4250 }),
    tx({ date: '2026-08-15', description: 'TECH CORP PAYROLL', amount: 4250 }),
    tx({ date: '2026-08-02', description: 'WELLS FARGO MTG AUTOPAY', amount: -2800 }),
    tx({ date: '2026-08-03', description: 'WHOLE FOODS', amount: -300 }),
    tx({ date: '2026-08-10', description: 'TRADER JOES', amount: -200 }),
    tx({ date: '2026-08-11', description: 'WHOLE FOODS REFUND', amount: 25 }),      // refund nets against groceries? (income sign → no expense match)
    tx({ date: '2026-08-20', description: 'CHASE CREDIT CRD AUTOPAY', amount: -1450 }), // transfer
    tx({ date: '2026-08-21', description: 'PET SUPPLIES PLUS', amount: -60 })       // unmatched
  ];
  const a = L.computeActuals(txs, BUDGET);
  assert.equal(a.months, 1);
  assert.equal(a.byItem.b1.monthly, 8500);
  assert.equal(a.byItem.b3.monthly, 2800);
  assert.equal(a.byItem.b4.monthly, 500);
  assert.equal(a.unmatched.transfers, -1450);
  assert.equal(a.unmatched.expense, -60);
  assert.equal(a.byCategory['Other Expense'], -60);
  assert.ok(!a.byItem.b6);
});

test('computeActuals: three months of data → monthly average', () => {
  const txs = [];
  for (const m of ['06', '07', '08']) {
    txs.push(tx({ date: `2026-${m}-01`, description: 'PAYROLL', amount: 4000 }));
    txs.push(tx({ date: `2026-${m}-05`, description: 'KROGER', amount: -300 }));
  }
  txs.push(tx({ date: '2026-08-06', description: 'KROGER', amount: -300 })); // extra grocery trip in Aug
  const a = L.computeActuals(txs, BUDGET);
  assert.equal(a.months, 3);
  assert.equal(a.byItem.b1.monthly, 4000);
  assert.equal(a.byItem.b4.monthly, 400); // (300*4)/3
  const a1 = L.computeActuals(txs, BUDGET, L.lastNMonthsPeriod(txs, 1));
  assert.equal(a1.byItem.b4.monthly, 600);
});

test('applyActuals: only matched items change; manual values kept; input not mutated', () => {
  const txs = [tx({ date: '2026-08-01', description: 'PAYROLL', amount: 5000 })];
  const a = L.computeActuals(txs, BUDGET);
  const out = L.applyActuals(BUDGET, a);
  assert.equal(out[0].actual, 5000);
  assert.equal(out[0].actualSource, 'transactions');
  assert.equal(out[3].actual, 900);
  assert.equal(out[3].actualSource, undefined);
  assert.equal(BUDGET[0].actual, 8500);
});

test('sortByDateDesc', () => {
  const r = L.sortByDateDesc([tx({ date: '2026-01-01' }), tx({ date: '2026-03-01' }), tx({ date: '2026-02-01' })]);
  assert.deepEqual(r.map(t => t.date), ['2026-03-01', '2026-02-01', '2026-01-01']);
});

test('applyActuals: explicit manual override is respected', () => {
  const budget = BUDGET.map(b => b.id === 'b1' ? Object.assign({}, b, { actual: 1234, actualSource: 'manual' }) : b);
  const a = L.computeActuals([tx({ date: '2026-08-01', description: 'PAYROLL', amount: 5000 })], budget);
  assert.equal(L.applyActuals(budget, a)[0].actual, 1234);
});

test('periodFromTransactions: incomplete current month is excluded unless it is all we have', () => {
  const T = { today: '2026-09-07' };
  const txs = [tx({ date: '2026-08-03' }), tx({ date: '2026-09-01' }), tx({ date: '2026-09-05' })];
  assert.deepEqual(L.periodFromTransactions(txs, T), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(L.periodFromTransactions([tx({ date: '2026-09-01' })], T), { start: '2026-09-01', end: '2026-09-30' });
  // on the last day of the month the month is complete
  assert.deepEqual(L.periodFromTransactions(txs, { today: '2026-09-30' }), { start: '2026-08-01', end: '2026-09-30' });
  // actuals ignore the September rows
  const a = L.computeActuals([tx({ date: '2026-08-01', description: 'PAYROLL', amount: 4000 }), tx({ date: '2026-09-01', description: 'PAYROLL', amount: 4000 })], BUDGET, null, T);
  assert.equal(a.months, 1);
  assert.equal(a.byItem.b1.monthly, 4000);
});
