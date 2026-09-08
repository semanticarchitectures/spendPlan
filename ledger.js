/**
 * SpendPlan ledger — the transaction model and everything derived from it.
 * Pure functions, no DOM.  Transactions are the source of truth; "actuals"
 * on budget items are derived from them for a chosen period.
 *
 * Transaction shape:
 *   { id, key, date: 'YYYY-MM-DD', description, amount (+in / -out),
 *     category: string|null, account, accountType, fitid: string|null, source }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendPlanLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Dedupe keys.  Prefer the bank's FITID; otherwise hash date|amount|desc|acct.
  // Legitimate duplicates inside one statement (two identical coffees on the
  // same day) get an occurrence suffix so they are kept.
  // ---------------------------------------------------------------------------
  function normDesc(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b\d{4,}\b/g, '').trim();
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function baseKey(tx) {
    const acct = String(tx.account || '').toLowerCase();
    if (tx.fitid) return `fit:${acct}:${tx.fitid}`;
    return 'h:' + hash(`${tx.date}|${Number(tx.amount).toFixed(2)}|${normDesc(tx.description)}|${acct}`);
  }

  /**
   * Merge incoming transactions into existing, skipping ones already present.
   * Returns { transactions, added, skipped }.
   */
  function mergeTransactions(existing, incoming) {
    const have = new Set();
    (existing || []).forEach(tx => { have.add(tx.key || baseKey(tx)); });

    const out = (existing || []).slice();
    const added = [], skipped = [];
    const seenInBatch = {};

    (incoming || []).forEach(tx => {
      const b = baseKey(tx);
      const occ = seenInBatch[b] || 0;
      seenInBatch[b] = occ + 1;
      const key = occ === 0 ? b : `${b}#${occ}`;
      if (have.has(key)) { skipped.push(tx); return; }
      const rec = Object.assign({}, tx, {
        id: tx.id || ('tx-' + hash(key + Date.now() + Math.random())),
        key
      });
      have.add(key);
      out.push(rec);
      added.push(rec);
    });

    return { transactions: out, added, skipped };
  }

  // ---------------------------------------------------------------------------
  // Categorisation.  Order of precedence:
  //   1. tx.categoryOverride (user assigned)
  //   2. keyword rules on the description (sign-aware)
  //   3. the category the bank supplied, mapped through aliases
  // Transfers / card payments are flagged so they never count as spending.
  // ---------------------------------------------------------------------------
  const TRANSFER = 'Transfer';

  // Order matters: the first matching rule wins.  Housing/Salary/Fees come
  // before Transfer so "MORTGAGE AUTOPAY" is housing, not a transfer.
  const CATEGORY_RULES = [
    { category: 'Salary', sign: 'in', keywords: ['payroll', 'salary', 'direct dep', 'paycheck', 'wages', 'dir dep', 'ppd'] },
    { category: 'Dividends', sign: 'in', keywords: ['dividend', 'interest', 'distribution', 'capital gain', 'div '] },
    { category: 'Fees', sign: 'out', keywords: ['interest charge', 'late fee', 'annual fee', 'service fee', 'overdraft', 'finance charge'] },
    { category: 'Housing', keywords: ['mortgage', 'mtg', 'home loan', 'escrow', 'rent ', 'lease payment', 'hoa', 'property tax'] },
    { category: TRANSFER, keywords: ['payment thank you', 'thank you', 'automatic payment', 'autopay', 'online payment', 'online pmt', 'transfer', 'xfer', 'zelle', 'venmo', 'paypal', 'cash app', 'credit card payment', 'card payment', 'crd pmt', 'ach payment', 'epay'] },
    { category: 'Groceries', keywords: ['grocery', 'grocer', 'supermarket', 'whole foods', 'wholefds', 'trader joe', 'costco', 'aldi', 'safeway', 'kroger', 'publix', 'wegmans', 'stop & shop', 'stop and shop', 'shoprite', 'h-e-b', 'heb ', 'sprouts', 'food lion', 'giant '] },
    { category: 'Utilities', keywords: ['electric', 'gas bill', 'water bill', 'utility', 'utilities', 'pg&e', 'pge', 'con ed', 'coned', 'duke energy', 'national grid', 'internet', 'comcast', 'xfinity', 'spectrum', 'verizon', 'at&t', 'att ', 't-mobile', 'tmobile', 'fios'] },
    { category: 'Dining', keywords: ['restaurant', 'dining', 'doordash', 'uber eats', 'ubereats', 'grubhub', 'mcdonald', 'starbucks', 'chipotle', 'pizza', 'sushi', 'cafe', 'coffee', 'dunkin', 'panera', 'taco', 'burger', 'bar & grill', 'grill', 'bistro', 'kitchen', 'diner'] },
    { category: 'Entertainment', keywords: ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'amazon prime', 'prime video', 'theater', 'theatre', 'cinema', 'amc ', 'concert', 'ticketmaster', 'apple tv', 'hbo', 'max ', 'peacock', 'paramount+', 'steam games', 'playstation', 'xbox', 'nintendo'] },
    { category: 'Auto', keywords: ['gas station', 'shell oil', 'shell service', 'chevron', 'exxon', 'mobil', 'bp ', 'sunoco', 'wawa', 'speedway', 'auto insurance', 'geico', 'progressive ins', 'state farm', 'allstate', 'car wash', 'jiffy lube', 'autozone', 'toll', 'ez pass', 'e-zpass', 'parking', 'dmv'] },
    { category: 'Health', keywords: ['doctor', 'pharmacy', 'cvs', 'walgreens', 'rite aid', 'dental', 'dentist', 'vision', 'optometr', 'medical', 'health', 'hospital', 'clinic', 'gym', 'fitness', 'planet fitness', 'peloton', 'urgent care', 'lab corp', 'labcorp', 'quest diag'] },
    { category: 'Shopping', keywords: ['amazon', 'amzn', 'target', 'walmart', 'wal-mart', 'clothing', 'apparel', 'zappos', 'nordstrom', 'macy', 'best buy', 'home depot', 'lowe\'s', 'lowes', 'ikea', 'etsy', 'ebay', 'nike', 'gap ', 'old navy', 'tj maxx', 'marshalls'] },
    { category: 'Vacation', keywords: ['travel', 'airline', 'airlines', 'hotel', 'airbnb', 'vrbo', 'expedia', 'booking.com', 'delta air', 'united air', 'southwest', 'jetblue', 'american air', 'alaska air', 'hilton', 'marriott', 'hyatt', 'resort', 'cruise', 'amtrak'] },
    { category: 'Insurance', keywords: ['insurance', 'assurance', 'life ins', 'home ins', 'renters ins'] },
    { category: 'Education', keywords: ['tuition', 'university', 'college', 'school', 'student loan', 'navient', 'nelnet', 'sallie mae', 'coursera', 'udemy'] },
    { category: 'Childcare', keywords: ['daycare', 'child care', 'childcare', 'preschool', 'nanny', 'babysit'] },
    { category: 'Charity', keywords: ['donation', 'charity', 'church', 'tithe', 'gofundme', 'red cross', 'unicef'] },
    { category: 'Cash', keywords: ['atm', 'cash withdrawal', 'withdrawal'] }
  ];

  const CATEGORY_ALIASES = {
    'food & drink': 'Dining', 'food': 'Groceries', 'restaurants': 'Dining', 'dining out': 'Dining',
    'gas': 'Auto', 'gas/automotive': 'Auto', 'automotive': 'Auto', 'transportation': 'Auto', 'travel': 'Vacation',
    'bills & utilities': 'Utilities', 'bills': 'Utilities', 'phone': 'Utilities', 'internet': 'Utilities',
    'home': 'Housing', 'mortgage & rent': 'Housing', 'rent': 'Housing',
    'health & wellness': 'Health', 'healthcare': 'Health', 'medical': 'Health', 'fitness': 'Health',
    'merchandise': 'Shopping', 'shopping': 'Shopping', 'clothing': 'Shopping', 'personal': 'Shopping',
    'entertainment': 'Entertainment', 'income': 'Salary', 'paycheck': 'Salary', 'payroll': 'Salary',
    'payment/credit': TRANSFER, 'payment': TRANSFER, 'transfer': TRANSFER, 'credit card payment': TRANSFER,
    'fees & adjustments': 'Fees', 'fees': 'Fees', 'interest': 'Dividends',
    'groceries': 'Groceries', 'grocery': 'Groceries', 'education': 'Education', 'gifts & donations': 'Charity'
  };

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const COMPILED = CATEGORY_RULES.map(r => ({
    category: r.category,
    sign: r.sign || null,
    re: new RegExp('(?:^|[^a-z0-9])' + r.keywords.map(escapeRegex).join('|(?:^|[^a-z0-9])'), 'i')
  }));

  function categorize(tx) {
    if (tx.categoryOverride) return tx.categoryOverride;
    const desc = String(tx.description || '').toLowerCase();
    const sign = tx.amount > 0 ? 'in' : 'out';
    for (const rule of COMPILED) {
      if (rule.sign && rule.sign !== sign) continue;
      if (rule.re.test(desc)) return rule.category;
    }
    if (tx.category) {
      const k = String(tx.category).toLowerCase().trim();
      if (CATEGORY_ALIASES[k]) return CATEGORY_ALIASES[k];
      return String(tx.category).trim();
    }
    return null;
  }

  function isTransfer(tx) {
    return categorize(tx) === TRANSFER || (tx.accountType === 'investment' && /\b(buy|sell|bought|sold|reinvest)\b/i.test(tx.description || ''));
  }

  // ---------------------------------------------------------------------------
  // Matching a category to a budget item.  Explicit `item.categories` list
  // wins; otherwise token overlap between the item name and the category.
  // ---------------------------------------------------------------------------
  const CATEGORY_SYNONYMS = {
    'auto': ['auto', 'car', 'vehicle', 'gas', 'fuel', 'transportation', 'commute'],
    'shopping': ['shopping', 'clothing', 'apparel', 'retail', 'merchandise', 'personal'],
    'vacation': ['vacation', 'travel', 'trip', 'holiday'],
    'dining': ['dining', 'restaurant', 'restaurants', 'eating', 'takeout'],
    'entertainment': ['entertainment', 'fun', 'subscriptions', 'streaming'],
    'health': ['health', 'medical', 'fitness', 'gym', 'pharmacy', 'wellness'],
    'utilities': ['utilities', 'utility', 'internet', 'phone', 'electric', 'power', 'water'],
    'housing': ['housing', 'mortgage', 'rent', 'home', 'house'],
    'groceries': ['groceries', 'grocery', 'household', 'food', 'supermarket'],
    'salary': ['salary', 'paycheck', 'wages', 'job', 'employment', 'primary'],
    'dividends': ['dividends', 'dividend', 'investments', 'investment', 'interest', 'passive'],
    'fees': ['fees', 'fee', 'bank', 'charges'],
    'insurance': ['insurance', 'premium'],
    'education': ['education', 'tuition', 'school', 'student'],
    'childcare': ['childcare', 'daycare', 'kids', 'children'],
    'charity': ['charity', 'giving', 'donations', 'church'],
    'cash': ['cash', 'atm']
  };

  const STOP = new Set(['and', 'the', 'or', 'of', 'a', 'an', '&', 'misc', 'other', 'payment', 'expenses', 'expense', 'income', 'monthly']);
  function tokens(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));
  }

  function matchBudgetItem(budget, category, sign) {
    if (!category) return null;
    const cat = String(category).toLowerCase();
    const wantType = sign === 'in' ? 'income' : 'expense';
    let best = null, bestScore = 0;
    for (const item of budget) {
      if (item.type !== wantType) continue;
      if (Array.isArray(item.categories) && item.categories.some(c => String(c).toLowerCase() === cat)) return item;
      const it = tokens(item.name);
      const ct = CATEGORY_SYNONYMS[cat] || tokens(cat);
      let score = 0;
      for (const t of ct) if (it.some(x => x === t || x.startsWith(t) || t.startsWith(x))) score++;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Periods.  A period is { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } inclusive.
  // ---------------------------------------------------------------------------
  function monthStart(iso) { return iso.slice(0, 7) + '-01'; }
  function monthEnd(iso) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${iso.slice(0, 7)}-${String(d).padStart(2, '0')}`;
  }
  function monthsBetween(startIso, endIso) {
    const sy = +startIso.slice(0, 4), sm = +startIso.slice(5, 7);
    const ey = +endIso.slice(0, 4), em = +endIso.slice(5, 7);
    return (ey - sy) * 12 + (em - sm) + 1;
  }

  function todayIso(opts) {
    if (opts && opts.today) return opts.today;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Whole calendar months spanning all transactions with valid dates.
   * The current month is still in progress, so it is excluded (it would
   * otherwise dilute the monthly average) — unless it is the only month
   * we have.  Pass opts.today ('YYYY-MM-DD') to override the clock.
   */
  function periodFromTransactions(transactions, opts) {
    const dates = (transactions || []).map(t => t.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
    if (dates.length === 0) return null;
    const today = todayIso(opts);
    const currentMonth = today.slice(0, 7);
    const monthIncomplete = today < monthEnd(today);
    let last = dates[dates.length - 1];
    if (monthIncomplete && last.slice(0, 7) >= currentMonth) {
      const earlier = dates.filter(d => d.slice(0, 7) < currentMonth);
      if (earlier.length) last = earlier[earlier.length - 1];
    }
    return { start: monthStart(dates[0]), end: monthEnd(last) };
  }

  /** The last `n` whole calendar months ending at the latest complete month. */
  function lastNMonthsPeriod(transactions, n, opts) {
    const p = periodFromTransactions(transactions, opts);
    if (!p) return null;
    const ey = +p.end.slice(0, 4), em = +p.end.slice(5, 7);
    const startIdx = ey * 12 + (em - 1) - (n - 1);
    const sy = Math.floor(startIdx / 12), sm = (startIdx % 12) + 1;
    const start = `${sy}-${String(sm).padStart(2, '0')}-01`;
    return { start: start > p.start ? start : p.start, end: p.end };
  }

  function inPeriod(tx, period) {
    return !!period && tx.date >= period.start && tx.date <= period.end;
  }

  // ---------------------------------------------------------------------------
  // Actuals: sum transactions per budget item over a period, expressed as a
  // monthly-equivalent (total / months in period).  Transfers are excluded.
  // ---------------------------------------------------------------------------
  function computeActuals(transactions, budget, period, opts) {
    period = period || periodFromTransactions(transactions, opts);
    const months = period ? monthsBetween(period.start, period.end) : 0;
    const byItem = {};
    const byCategory = {};
    const unmatched = { income: 0, expense: 0, transfers: 0, count: 0 };
    let considered = 0;

    (transactions || []).forEach(tx => {
      if (!inPeriod(tx, period)) return;
      if (isTransfer(tx)) { unmatched.transfers += tx.amount; return; }
      considered++;
      const sign = tx.amount > 0 ? 'in' : 'out';
      const category = categorize(tx) || (sign === 'in' ? 'Other Income' : 'Other Expense');
      byCategory[category] = (byCategory[category] || 0) + tx.amount;
      const item = matchBudgetItem(budget, category, sign);
      if (item) {
        const rec = byItem[item.id] || (byItem[item.id] = { total: 0, count: 0, monthly: 0, type: item.type, categories: new Set() });
        rec.total += tx.amount;
        rec.count++;
        rec.categories.add(category);
      } else {
        unmatched.count++;
        if (sign === 'in') unmatched.income += tx.amount; else unmatched.expense += tx.amount;
      }
    });

    Object.values(byItem).forEach(rec => {
      rec.total = Math.round(rec.total * 100) / 100;
      // Expense items: outflows are negative, so flip; net refunds floor at 0.
      const signed = rec.type === 'income' ? rec.total : -rec.total;
      rec.monthly = months > 0 ? Math.round(Math.max(0, signed) / months * 100) / 100 : 0;
      rec.categories = Array.from(rec.categories);
    });

    return { period, months, byItem, byCategory, unmatched, considered };
  }

  /**
   * Return a new budget array with `actual` set from computed actuals for
   * matched items (source 'transactions').  Items with no transactions, or
   * with an explicit manual override (actualSource === 'manual'), are untouched.
   */
  function applyActuals(budget, actuals) {
    return budget.map(item => {
      const rec = actuals.byItem[item.id];
      if (!rec || item.actualSource === 'manual') return Object.assign({}, item);
      return Object.assign({}, item, { actual: rec.monthly, actualSource: 'transactions', actualTxCount: rec.count });
    });
  }

  function sortByDateDesc(transactions) {
    return (transactions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
  }

  return {
    TRANSFER,
    CATEGORY_RULES,
    baseKey,
    mergeTransactions,
    categorize,
    isTransfer,
    matchBudgetItem,
    periodFromTransactions,
    lastNMonthsPeriod,
    monthsBetween,
    inPeriod,
    computeActuals,
    applyActuals,
    sortByDateDesc
  };
});
