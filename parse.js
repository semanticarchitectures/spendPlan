/**
 * SpendPlan statement parsing — pure functions, no DOM.
 *
 * Exposed as window.SpendPlanParse in the browser and via module.exports in Node
 * so the same code can be unit-tested with `node --test tests/`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendPlanParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CSV (RFC 4180): quoted fields, "" escapes, embedded newlines, CRLF,
  // empty fields preserved, delimiter auto-detected among , ; \t |
  // ---------------------------------------------------------------------------
  function detectDelimiter(text) {
    const sample = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n');
    const candidates = [',', ';', '\t', '|'];
    let best = ',', bestCount = -1;
    for (const d of candidates) {
      // count delimiters outside quotes on the first line
      const firstLine = sample.split('\n')[0] || '';
      let count = 0, inQ = false;
      for (const ch of firstLine) {
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) count++;
      }
      if (count > bestCount) { bestCount = count; best = d; }
    }
    return best;
  }

  function parseCSV(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') return { headers: [], rows: [], delimiter: ',' };
    // Strip BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const delimiter = opts.delimiter || detectDelimiter(text);

    const records = [];
    let row = [], field = '', inQuotes = false, i = 0;
    const n = text.length;

    while (i < n) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }

    // Drop fully-empty records (blank lines)
    const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''));
    if (nonEmpty.length === 0) return { headers: [], rows: [], delimiter };

    // Some banks prepend preamble lines (account info) before the real header.
    // Heuristic: the header is the first record whose field count matches the
    // modal field count of the file.
    const counts = {};
    nonEmpty.forEach(r => { counts[r.length] = (counts[r.length] || 0) + 1; });
    const modal = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0]);
    let headerIdx = nonEmpty.findIndex(r => r.length === modal);
    if (headerIdx < 0) headerIdx = 0;

    const headers = nonEmpty[headerIdx].map(h => h.trim());
    const rows = nonEmpty.slice(headerIdx + 1).map(r => {
      // pad / trim to header width so column indices are stable
      const out = r.slice(0, headers.length).map(c => c.trim());
      while (out.length < headers.length) out.push('');
      return out;
    });
    return { headers, rows, delimiter };
  }

  // ---------------------------------------------------------------------------
  // Amounts: "$1,234.56", "-1,234.56", "(1,234.56)", "1.234,56" (EU), "12.34-",
  // "12.34 CR" / "12.34 DR", surrounding quotes/whitespace.  Returns NaN if the
  // string carries no usable number.
  // ---------------------------------------------------------------------------
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim().replace(/^"+|"+$/g, '').replace(/[−–]/g, '-').trim();
    if (s === '') return NaN;

    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ''); }
    if (/\bDR\b/i.test(s)) { negative = true; }
    if (/\bCR\b/i.test(s)) { negative = false; }
    s = s.replace(/\b(CR|DR)\b/gi, '');
    s = s.replace(/[^\d.,\-+]/g, ''); // strip currency symbols, spaces, letters
    if (s.startsWith('-')) { negative = true; s = s.slice(1); }
    if (s.startsWith('+')) s = s.slice(1);

    // Decide decimal separator.
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // EU style "1.234,56" or "1234,56"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(s)) return NaN;
    const v = parseFloat(s);
    if (isNaN(v)) return NaN;
    return negative ? -v : v;
  }

  // ---------------------------------------------------------------------------
  // Dates → ISO "YYYY-MM-DD".  Returns null when unparseable.
  // Accepts ISO, US M/D/Y (2- or 4-digit year), OFX YYYYMMDD[HHMMSS[.xxx][tz]],
  // "DD-MMM-YYYY", "MMM DD, YYYY", "YYYY/MM/DD".  dayFirst=true reads D/M/Y.
  // ---------------------------------------------------------------------------
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  function pad2(n) { return String(n).padStart(2, '0'); }

  function validYMD(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function expandYear(y) {
    y = Number(y);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return y;
  }

  function parseDate(raw, opts) {
    opts = opts || {};
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim().replace(/^"+|"+$/g, '').trim();
    if (!s) return null;
    let m;

    // ISO / YYYY-MM-DD / YYYY/MM/DD, optional time
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))) {
      return validYMD(+m[1], +m[2], +m[3]);
    }
    // OFX compact: 20260901 or 20260901120000.000[-5:EST]
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?)?(?:\[.*\])?$/))) {
      return validYMD(+m[1], +m[2], +m[3]);
    }
    // Numeric with separators: M/D/Y or D/M/Y
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[T\s].*)?$/))) {
      const a = +m[1], b = +m[2], y = expandYear(m[3]);
      let mo = a, d = b;
      if (opts.dayFirst || a > 12) { mo = b; d = a; }
      return validYMD(y, mo, d);
    }
    // DD-MMM-YYYY / DD MMM YYYY
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s,]+(\d{2,4})$/))) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (!mo) return null;
      return validYMD(expandYear(m[3]), mo, +m[1]);
    }
    // MMM DD, YYYY / MMM DD YYYY / September 1, 2026
    if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{2,4})$/))) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (!mo) return null;
      return validYMD(expandYear(m[3]), mo, +m[2]);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // OFX / QFX (SGML 1.x and XML 2.x).  Returns a table shaped like parseCSV so
  // the UI can reuse the same preview + mapping flow.
  // ---------------------------------------------------------------------------
  function ofxTag(block, tag) {
    const r = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i');
    const m = block.match(r);
    return m ? m[1].trim() : '';
  }

  function parseOFX(text) {
    if (typeof text !== 'string') return { headers: [], rows: [], accountType: 'checking', accountId: '', balance: null };
    const upper = text.toUpperCase();
    const accountType = upper.includes('<CCACCTFROM>') || upper.includes('<CREDITCARDMSGSRSV1>') ? 'credit'
      : upper.includes('<INVACCTFROM>') ? 'investment' : 'checking';
    const acctId = ofxTag(text, 'ACCTID');
    const balRaw = ofxTag(text, 'BALAMT');
    const balance = balRaw ? parseAmount(balRaw) : null;

    const headers = ['Date', 'Description', 'Amount', 'Type', 'FITID', 'Memo'];
    const rows = [];
    const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi;
    let m;
    while ((m = re.exec(text))) {
      const b = m[1];
      const name = ofxTag(b, 'NAME');
      const memo = ofxTag(b, 'MEMO');
      rows.push([
        ofxTag(b, 'DTPOSTED'),
        name || memo,
        ofxTag(b, 'TRNAMT'),
        ofxTag(b, 'TRNTYPE'),
        ofxTag(b, 'FITID'),
        memo
      ]);
    }
    return { headers, rows, accountType, accountId: acctId, balance };
  }

  // ---------------------------------------------------------------------------
  // Column auto-detection.  Returns indices (or -1) for each role.
  // ---------------------------------------------------------------------------
  function detectColumns(headers) {
    const h = headers.map(x => String(x || '').toLowerCase().trim());
    const find = (preds) => {
      for (const p of preds) { const i = h.findIndex(p); if (i !== -1) return i; }
      return -1;
    };
    const eq = (s) => (x) => x === s;
    const has = (s) => (x) => x.includes(s);

    const date = find([eq('date'), eq('transaction date'), eq('posted date'), eq('post date'), has('date')]);
    const description = find([eq('description'), eq('payee'), eq('name'), eq('merchant'), has('desc'), has('payee'), has('merchant'), has('memo'), has('name')]);
    const debit = find([eq('debit'), eq('withdrawal'), eq('withdrawals'), has('debit'), has('withdraw'), has('money out')]);
    const credit = find([eq('credit'), eq('deposit'), eq('deposits'), has('credit'), has('deposit'), has('money in')]);
    const amount = find([eq('amount'), eq('transaction amount'), eq('amt'), has('amount'), has('total')]);
    const category = find([eq('category'), has('categor')]);
    const fitid = find([eq('fitid'), has('reference'), has('transaction id'), has('ref')]);

    // If both an Amount column and Debit/Credit columns exist, prefer Amount.
    return {
      date, description, category, fitid,
      amount,
      debit: amount === -1 ? debit : -1,
      credit: amount === -1 ? credit : -1
    };
  }

  // ---------------------------------------------------------------------------
  // Sign convention.  SpendPlan stores amounts as: positive = money in,
  // negative = money out.  Bank exports mostly already do this.  Credit card
  // exports are split: Chase/Citi use negative = charge; Amex/Capital One use
  // positive = charge.  Heuristic: on a credit account, if most rows are
  // positive they are almost certainly charges, so invert.
  // ---------------------------------------------------------------------------
  function suggestInvert(amounts, accountType) {
    const nums = amounts.filter(a => typeof a === 'number' && !isNaN(a) && a !== 0);
    if (nums.length === 0) return false;
    const pos = nums.filter(a => a > 0).length;
    const ratio = pos / nums.length;
    if (accountType === 'credit') return ratio > 0.5;
    // For bank accounts, an export where >90% of rows are positive and it is
    // labelled "Debit" is rare — leave alone.
    return false;
  }

  // ---------------------------------------------------------------------------
  // Turn raw rows + a column mapping into canonical transaction records.
  // mapping: { date, description, amount, debit, credit, category, fitid }
  // options: { accountType, accountLabel, invert, dayFirst, source }
  // Returns { transactions, skipped: [{rowIndex, reason}] }
  // ---------------------------------------------------------------------------
  function rowsToTransactions(rows, mapping, options) {
    options = options || {};
    const out = [], skipped = [];
    const get = (row, idx) => (idx !== undefined && idx !== null && idx >= 0 && idx < row.length) ? row[idx] : '';

    rows.forEach((row, rowIndex) => {
      const date = parseDate(get(row, mapping.date), { dayFirst: options.dayFirst });
      if (!date) { skipped.push({ rowIndex, reason: 'unparseable date', raw: row }); return; }

      let amount;
      if (mapping.amount >= 0) {
        amount = parseAmount(get(row, mapping.amount));
      } else {
        const debit = parseAmount(get(row, mapping.debit));
        const credit = parseAmount(get(row, mapping.credit));
        if (isNaN(debit) && isNaN(credit)) amount = NaN;
        else amount = (isNaN(credit) ? 0 : Math.abs(credit)) - (isNaN(debit) ? 0 : Math.abs(debit));
      }
      if (isNaN(amount)) { skipped.push({ rowIndex, reason: 'unparseable amount', raw: row }); return; }
      if (options.invert) amount = -amount;
      amount = Math.round(amount * 100) / 100;

      const description = (get(row, mapping.description) || 'Imported transaction').trim();
      const category = (get(row, mapping.category) || '').trim();
      const fitid = (get(row, mapping.fitid) || '').trim();

      out.push({
        date,
        description,
        amount,
        category: category || null,
        account: options.accountLabel || (options.accountType || 'checking'),
        accountType: options.accountType || 'checking',
        fitid: fitid || null,
        source: options.source || 'import'
      });
    });
    return { transactions: out, skipped };
  }

  return {
    parseCSV,
    detectDelimiter,
    parseAmount,
    parseDate,
    parseOFX,
    detectColumns,
    suggestInvert,
    rowsToTransactions
  };
});
