/**
 * SpendPlan projection engine — pure functions, no DOM.
 *
 * A monthly balance-sheet simulation:
 *   • every asset grows at its own annual yield (monthly compounding);
 *   • every liability accrues interest and is paid down by a fixed payment
 *     (amortization) until it reaches zero, at which point the payment is
 *     freed back into cash flow;
 *   • non-debt expenses and income inflate; loan payments do not;
 *   • monthly surplus is contributed to investments, deficits are drawn from
 *     cash first, then investments;
 *   • one-off events hit at month 1.
 *
 * Net-worth identity per month: ΔNW = income − nonDebtExpenses − interest + assetReturns.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendPlanProjection = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_INFLATION = 3.0;      // % per year, used by the baseline
  const HORIZON_MONTHS = 120;

  const INVESTABLE = ['Investment / Stocks', 'Retirement'];
  const CASH = ['Cash / Liquid'];

  const DEFAULT_TERMS = {              // months, used when a liability has no payment
    'Mortgage': 360,
    'Student Loan': 120,
    'Auto Loan': 60,
    'Credit Card': 36,
    'Personal / Other': 60
  };

  // ---------------------------------------------------------------------------
  // Loan maths
  // ---------------------------------------------------------------------------
  function loanPayment(balance, annualRatePct, termMonths) {
    balance = Number(balance) || 0;
    termMonths = Math.max(1, Math.round(Number(termMonths) || 1));
    const r = (Number(annualRatePct) || 0) / 100 / 12;
    if (balance <= 0) return 0;
    if (r === 0) return balance / termMonths;
    return balance * r / (1 - Math.pow(1 + r, -termMonths));
  }

  function defaultTermMonths(category) {
    return DEFAULT_TERMS[category] || 60;
  }

  /** The payment to use for a liability: the user's, or an estimate from the default term. */
  function liabilityPayment(liab) {
    const p = Number(liab.payment);
    if (p > 0) return p;
    return roundCents(loanPayment(liab.balance, liab.rate, defaultTermMonths(liab.category)));
  }

  function isPaymentEstimated(liab) {
    return !(Number(liab.payment) > 0);
  }

  function roundCents(v) { return Math.round(v * 100) / 100; }

  /**
   * Amortization schedule for one liability.
   * Returns { payment, months, totalInterest, payoffMonth|null, neverPaysOff, rows }.
   * If the payment doesn't cover interest, the balance grows; we stop at maxMonths.
   */
  function amortizationSchedule(liab, maxMonths, opts) {
    maxMonths = maxMonths || 600;
    const payment = (opts && opts.payment !== undefined) ? opts.payment : liabilityPayment(liab);
    const r = (Number(liab.rate) || 0) / 100 / 12;
    let bal = Number(liab.balance) || 0;
    let totalInterest = 0, payoffMonth = null;
    const rows = [];
    for (let m = 1; m <= maxMonths && bal > 0.005; m++) {
      const interest = bal * r;
      const due = bal + interest;
      const pay = Math.min(payment, due);
      const principal = pay - interest;
      bal = due - pay;
      totalInterest += interest;
      rows.push({ month: m, interest: roundCents(interest), principal: roundCents(principal), payment: roundCents(pay), balance: roundCents(Math.max(0, bal)) });
      if (bal <= 0.005) { payoffMonth = m; bal = 0; }
    }
    return {
      payment,
      months: rows.length,
      totalInterest: roundCents(totalInterest),
      payoffMonth,
      neverPaysOff: payoffMonth === null,
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // Budget helpers
  // ---------------------------------------------------------------------------
  function monthlyTotals(budget) {
    let income = 0, expenses = 0;
    (budget || []).forEach(b => {
      const v = Number(b.actual);
      if (!isFinite(v)) return;
      if (b.type === 'income') income += v; else expenses += v;
    });
    return { income, expenses };
  }

  function weightedInvestableYield(assets) {
    let sum = 0, w = 0, plain = 0, n = 0;
    (assets || []).forEach(a => {
      if (!INVESTABLE.includes(a.category)) return;
      sum += Number(a.value) * Number(a.yield || 0); w += Number(a.value);
      plain += Number(a.yield || 0); n++;
    });
    if (w > 0) return sum / w;
    return n > 0 ? plain / n : null;   // accounts exist but are empty: simple average
  }

  function investableValue(assets) {
    return (assets || []).filter(a => INVESTABLE.includes(a.category)).reduce((s, a) => s + Number(a.value), 0);
  }

  // ---------------------------------------------------------------------------
  // The simulation
  // ---------------------------------------------------------------------------
  /**
   * project({ budget, assets, liabilities, scenario, months })
   *
   * scenario: {
   *   incomeChange: %,          step change to income (default 0)
   *   spendingChange: %,        step change to NON-DEBT expenses (default 0)
   *   returnRate: %|null,       override yield for Investment/Retirement assets (null = per-asset)
   *   inflationRate: %,         annual, applied to income and non-debt expenses (default 3)
   *   oneOffs: [{ desc, amount, target? }]  applied at month 1 (negative = outflow);
 *             target 'investable' scales Investment/Retirement holdings instead of hitting cash
   * }
   *
   * Returns {
   *   years: [{ year, month, netWorth, assets, liabilities, cash, investable, realEstate, other,
   *             annualIncome, annualExpenses, annualDebtPayments, annualSurplus, annualInterest }],
   *   liabilities: [{ id, name, payment, inBudget, payoffMonth, totalInterest, neverPaysOff }],
   *   summary: { startNetWorth, endNetWorth, totalInterest, year1Surplus, year1Income, year1Expenses,
   *              year1DebtPayments, investGrowth, contributions, cashWentNegative, monthsSimulated }
   * }
   */
  function project(input) {
    const budget = input.budget || [];
    const assetsIn = input.assets || [];
    const liabsIn = input.liabilities || [];
    const sc = Object.assign({ incomeChange: 0, spendingChange: 0, returnRate: null, inflationRate: DEFAULT_INFLATION, oneOffs: [] }, input.scenario || {});
    const months = input.months || HORIZON_MONTHS;

    const { income: baseIncome, expenses: baseExpenses } = monthlyTotals(budget);

    // Liabilities: working copies
    const liabs = liabsIn.map(l => ({
      id: l.id, name: l.name, category: l.category,
      balance: Math.max(0, Number(l.balance) || 0),
      r: (Number(l.rate) || 0) / 100 / 12,
      payment: liabilityPayment(l),
      inBudget: l.inBudget !== false,
      paidOff: (Number(l.balance) || 0) <= 0,
      payoffMonth: (Number(l.balance) || 0) <= 0 ? 0 : null,
      totalInterest: 0
    }));

    // Budgeted debt payments are inside baseExpenses; separate them so they don't inflate.
    const budgetedDebt = Math.min(baseExpenses, liabs.filter(l => l.inBudget && !l.paidOff).reduce((s, l) => s + l.payment, 0));
    const baseOther = baseExpenses - budgetedDebt;

    // Assets: working copies with monthly growth factors
    const investOverride = sc.returnRate === null || sc.returnRate === undefined || isNaN(Number(sc.returnRate)) ? null : Number(sc.returnRate);
    const assets = assetsIn.map(a => {
      const isInv = INVESTABLE.includes(a.category);
      const y = isInv && investOverride !== null ? investOverride : Number(a.yield || 0);
      return { id: a.id, name: a.name, category: a.category, value: Number(a.value) || 0, gm: Math.pow(1 + y / 100, 1 / 12) };
    });
    const investYield = investOverride !== null ? investOverride : (weightedInvestableYield(assetsIn) ?? (assetsIn.find(a => CASH.includes(a.category))?.yield ?? 0));
    const contribGm = Math.pow(1 + Number(investYield) / 100, 1 / 12);
    // Synthetic bucket for new contributions (surplus) — counts as investable.
    const contributions = { id: '__contrib', name: 'New savings', category: 'Investment / Stocks', value: 0, gm: contribGm };
    assets.push(contributions);

    const infGm = Math.pow(1 + (Number(sc.inflationRate) || 0) / 100, 1 / 12);
    const incomeStep = 1 + (Number(sc.incomeChange) || 0) / 100;
    const spendStep = 1 + (Number(sc.spendingChange) || 0) / 100;

    const startInvestable = investableValue(assetsIn);
    const startNW = sumAssets(assets) - liabs.reduce((s, l) => s + l.balance, 0);

    const years = [snapshot(0, 0, assets, liabs, { income: 0, expenses: 0, debt: 0, surplus: 0, interest: 0 })];
    let yr = { income: 0, expenses: 0, debt: 0, surplus: 0, interest: 0 };
    let cashWentNegative = false;
    let totalContrib = 0, oneOffTotal = 0;
    let infl = 1;

    for (let m = 1; m <= months; m++) {
      infl *= infGm;
      const income = baseIncome * incomeStep * infl;
      const other = baseOther * spendStep * infl;

      // Debt service
      let debtPaid = 0, interestPaid = 0;
      liabs.forEach(l => {
        if (l.paidOff) return;
        const interest = l.balance * l.r;
        const due = l.balance + interest;
        const pay = Math.min(l.payment, due);
        l.balance = due - pay;
        l.totalInterest += interest;
        interestPaid += interest;
        debtPaid += pay;
        if (l.balance <= 0.005) { l.balance = 0; l.paidOff = true; l.payoffMonth = m; }
      });
      // Budgeted payments are part of "expenses" conceptually; unbudgeted ones are extra.
      // Either way cash out this month = other + all debt actually paid.  A budgeted
      // loan that is paid off frees its payment (already excluded because we only
      // count payments actually made).
      const expensesOut = other + debtPaid;
      const surplus = income - expensesOut;          // recurring cash flow
      let flow = surplus;                             // what actually gets allocated this month

      // Grow assets
      assets.forEach(a => { a.value *= a.gm; });

      // One-offs at month 1: cash events join this month's flow; investment
      // events (e.g. a market correction) scale the investable holdings directly.
      if (m === 1) (sc.oneOffs || []).forEach(o => {
        const amt = Number(o.amount) || 0;
        oneOffTotal += amt;
        if (o.target === 'investable') {
          const inv = assets.filter(a => INVESTABLE.includes(a.category) && a.id !== '__contrib');
          const total = inv.reduce((s, a) => s + a.value, 0);
          if (total > 0) { const f = Math.max(0, 1 + amt / total); inv.forEach(a => { a.value *= f; }); }
          else flow += amt;
        } else flow += amt;
      });

      // Allocate flow: surplus → new savings, deficit ← cash, then investments
      if (flow >= 0) { contributions.value += flow; totalContrib += flow; }
      else {
        let need = -flow;
        for (const a of assets) {
          if (!CASH.includes(a.category)) continue;
          const take = Math.min(a.value, need); a.value -= take; need -= take;
          if (need <= 0) break;
        }
        if (need > 0) {
          for (const a of assets) {
            if (!INVESTABLE.includes(a.category)) continue;
            const take = Math.min(Math.max(0, a.value), need); a.value -= take; need -= take;
            if (need <= 0) break;
          }
        }
        if (need > 0) { contributions.value -= need; cashWentNegative = true; }
      }

      yr.income += income; yr.expenses += expensesOut; yr.debt += debtPaid; yr.surplus += surplus; yr.interest += interestPaid;
      if (m % 12 === 0) {
        years.push(snapshot(m / 12, m, assets, liabs, yr));
        yr = { income: 0, expenses: 0, debt: 0, surplus: 0, interest: 0 };
      }
    }
    if (months % 12 !== 0) years.push(snapshot(months / 12, months, assets, liabs, yr));

    const endInvestable = assets.filter(a => INVESTABLE.includes(a.category) && a.id !== '__contrib').reduce((s, a) => s + a.value, 0);
    const y1 = years[1] || years[0];

    return {
      years,
      liabilities: liabs.map(l => ({
        id: l.id, name: l.name, payment: roundCents(l.payment), inBudget: l.inBudget,
        payoffMonth: l.payoffMonth, totalInterest: roundCents(l.totalInterest), neverPaysOff: !l.paidOff, balance: roundCents(l.balance)
      })),
      summary: {
        startNetWorth: Math.round(startNW),
        endNetWorth: years[years.length - 1].netWorth,
        totalInterest: Math.round(liabs.reduce((s, l) => s + l.totalInterest, 0)),
        year1Income: Math.round(y1.annualIncome),
        year1Expenses: Math.round(y1.annualExpenses),
        year1DebtPayments: Math.round(y1.annualDebtPayments),
        year1Surplus: Math.round(y1.annualSurplus),
        investGrowth: Math.round(endInvestable - startInvestable),
        contributions: Math.round(totalContrib),
        oneOffTotal: Math.round(oneOffTotal),
        investYieldUsed: Number(investYield),
        cashWentNegative,
        monthsSimulated: months
      }
    };
  }

  function sumAssets(assets) { return assets.reduce((s, a) => s + a.value, 0); }

  function snapshot(year, month, assets, liabs, yr) {
    const by = (cats) => assets.filter(a => cats.includes(a.category)).reduce((s, a) => s + a.value, 0);
    const totalA = sumAssets(assets);
    const totalL = liabs.reduce((s, l) => s + l.balance, 0);
    return {
      year, month,
      netWorth: Math.round(totalA - totalL),
      assets: Math.round(totalA),
      liabilities: Math.round(totalL),
      cash: Math.round(by(CASH)),
      investable: Math.round(by(INVESTABLE)),
      realEstate: Math.round(by(['Real Estate'])),
      other: Math.round(totalA - by(CASH) - by(INVESTABLE) - by(['Real Estate'])),
      annualIncome: yr.income, annualExpenses: yr.expenses, annualDebtPayments: yr.debt, annualSurplus: yr.surplus, annualInterest: yr.interest
    };
  }

  /** Baseline = no scenario adjustments, per-asset yields, default inflation. */
  function baselineScenario() {
    return { incomeChange: 0, spendingChange: 0, returnRate: null, inflationRate: DEFAULT_INFLATION, oneOffs: [] };
  }

  /** Format a month offset as a calendar label from a start date. */
  function monthLabel(startIso, monthOffset) {
    const y = +startIso.slice(0, 4), m0 = +startIso.slice(5, 7) - 1;
    const d = new Date(Date.UTC(y, m0 + monthOffset, 1));
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  return {
    DEFAULT_INFLATION,
    HORIZON_MONTHS,
    DEFAULT_TERMS,
    INVESTABLE,
    loanPayment,
    defaultTermMonths,
    liabilityPayment,
    isPaymentEstimated,
    amortizationSchedule,
    monthlyTotals,
    weightedInvestableYield,
    investableValue,
    project,
    baselineScenario,
    monthLabel
  };
});
