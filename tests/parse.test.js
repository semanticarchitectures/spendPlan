const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parse.js');

// ---------- parseCSV ----------
test('parseCSV: preserves empty fields and handles quotes, "" escapes, CRLF', () => {
  const text = 'Date,Description,Debit,Credit\r\n' +
    '09/01/2026,"Whole Foods Market, Inc.",245.50,\r\n' +
    '09/02/2026,"He said ""hi""",,4250.00\r\n';
  const { headers, rows } = P.parseCSV(text);
  assert.deepEqual(headers, ['Date', 'Description', 'Debit', 'Credit']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['09/01/2026', 'Whole Foods Market, Inc.', '245.50', '']);
  assert.deepEqual(rows[1], ['09/02/2026', 'He said "hi"', '', '4250.00']);
});

test('parseCSV: unquoted multi-word fields stay intact', () => {
  const { rows } = P.parseCSV('Date,Description,Amount\n2026-09-03,Whole Foods Market,-12.00\n');
  assert.equal(rows[0][1], 'Whole Foods Market');
});

test('parseCSV: embedded newline inside quoted field', () => {
  const { rows } = P.parseCSV('A,B\n"line1\nline2",x\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'line1\nline2');
});

test('parseCSV: skips preamble lines before the real header', () => {
  const text = 'Account Number: 1234\nStatement Period: Aug 2026\n\nDate,Description,Amount\n08/01/2026,Foo,-1.00\n08/02/2026,Bar,-2.00\n08/03/2026,Baz,-3.00\n';
  const { headers, rows } = P.parseCSV(text);
  assert.deepEqual(headers, ['Date', 'Description', 'Amount']);
  assert.equal(rows.length, 3);
});

test('parseCSV: BOM and semicolon delimiter', () => {
  const { headers, rows, delimiter } = P.parseCSV('﻿Date;Amount\n2026-01-01;1,50\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(headers, ['Date', 'Amount']);
  assert.equal(rows[0][1], '1,50');
});

// ---------- parseAmount ----------
test('parseAmount: common bank formats', () => {
  assert.equal(P.parseAmount('$1,234.56'), 1234.56);
  assert.equal(P.parseAmount('-1,234.56'), -1234.56);
  assert.equal(P.parseAmount('"-1,234.56"'), -1234.56);
  assert.equal(P.parseAmount('(1,234.56)'), -1234.56);
  assert.equal(P.parseAmount('12.34-'), -12.34);
  assert.equal(P.parseAmount(' 12.34 DR'), -12.34);
  assert.equal(P.parseAmount('12.34 CR'), 12.34);
  assert.equal(P.parseAmount('1.234,56'), 1234.56);
  assert.equal(P.parseAmount('−5'), -5); // unicode minus
  assert.equal(P.parseAmount(42), 42);
});

test('parseAmount: garbage → NaN', () => {
  assert.ok(isNaN(P.parseAmount('')));
  assert.ok(isNaN(P.parseAmount('N/A')));
  assert.ok(isNaN(P.parseAmount(null)));
  assert.ok(isNaN(P.parseAmount('abc')));
});

// ---------- parseDate ----------
test('parseDate: formats', () => {
  assert.equal(P.parseDate('2026-09-01'), '2026-09-01');
  assert.equal(P.parseDate('2026/09/01'), '2026-09-01');
  assert.equal(P.parseDate('09/01/2026'), '2026-09-01');
  assert.equal(P.parseDate('9/1/26'), '2026-09-01');
  assert.equal(P.parseDate('20260901'), '2026-09-01');
  assert.equal(P.parseDate('20260901120000.000[-5:EST]'), '2026-09-01');
  assert.equal(P.parseDate('01-Sep-2026'), '2026-09-01');
  assert.equal(P.parseDate('Sep 1, 2026'), '2026-09-01');
  assert.equal(P.parseDate('September 1, 2026'), '2026-09-01');
  assert.equal(P.parseDate('2026-09-01T10:00:00Z'), '2026-09-01');
  assert.equal(P.parseDate('25/12/2026'), '2026-12-25'); // day > 12 forces D/M/Y
  assert.equal(P.parseDate('01/09/2026', { dayFirst: true }), '2026-09-01');
});

test('parseDate: invalid → null', () => {
  assert.equal(P.parseDate('2026-13-01'), null);
  assert.equal(P.parseDate('02/30/2026'), null);
  assert.equal(P.parseDate('Whole Foods'), null);
  assert.equal(P.parseDate(''), null);
});

// ---------- parseOFX ----------
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CCACCTFROM>
<ACCTID>XXXX1234
</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260903120000.000[-5:EST]
<TRNAMT>-245.50
<FITID>2026090300123
<NAME>WHOLE FOODS MARKET
<MEMO>WHOLE FOODS MARKET #123
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260905
<TRNAMT>360.00
<FITID>2026090500456
<NAME>Q3 DIVIDEND
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-1450.00
<DTASOF>20260907
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;

test('parseOFX: SGML credit card statement', () => {
  const r = P.parseOFX(OFX_SGML);
  assert.equal(r.accountType, 'credit');
  assert.equal(r.accountId, 'XXXX1234');
  assert.equal(r.balance, -1450);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], ['20260903120000.000[-5:EST]', 'WHOLE FOODS MARKET', '-245.50', 'DEBIT', '2026090300123', 'WHOLE FOODS MARKET #123']);
  assert.equal(r.rows[1][1], 'Q3 DIVIDEND');
});

test('parseOFX: XML 2.x with closing tags', () => {
  const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>999</ACCTID></BANKACCTFROM>
  <BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260901</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>abc</FITID><NAME>Coffee</NAME></STMTTRN></BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = P.parseOFX(xml);
  assert.equal(r.accountType, 'checking');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0][1], 'Coffee');
  assert.equal(r.rows[0][4], 'abc');
});

// ---------- detectColumns ----------
test('detectColumns: Chase-style single amount', () => {
  const m = P.detectColumns(['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount', 'Memo']);
  assert.equal(m.date, 0);
  assert.equal(m.description, 2);
  assert.equal(m.category, 3);
  assert.equal(m.amount, 5);
  assert.equal(m.debit, -1);
});

test('detectColumns: Capital One-style debit/credit', () => {
  const m = P.detectColumns(['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Category', 'Debit', 'Credit']);
  assert.equal(m.amount, -1);
  assert.equal(m.debit, 5);
  assert.equal(m.credit, 6);
});

// ---------- suggestInvert ----------
test('suggestInvert: credit card with mostly positive charges → invert', () => {
  assert.equal(P.suggestInvert([12.5, 40, 99.99, -200], 'credit'), true);
  assert.equal(P.suggestInvert([-12.5, -40, -99.99, 200], 'credit'), false);
  assert.equal(P.suggestInvert([12.5, 40, 99.99], 'checking'), false);
});

// ---------- rowsToTransactions ----------
test('rowsToTransactions: debit/credit columns and inversion', () => {
  const rows = [
    ['09/01/2026', 'Payroll', '', '4,250.00'],
    ['09/02/2026', 'Mortgage', '2,800.00', ''],
    ['bad date', 'x', '1', ''],
    ['09/03/2026', 'no amount', '', '']
  ];
  const { transactions, skipped } = P.rowsToTransactions(rows, { date: 0, description: 1, amount: -1, debit: 2, credit: 3 }, { accountType: 'checking', accountLabel: 'Chase Checking' });
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amount, 4250);
  assert.equal(transactions[1].amount, -2800);
  assert.equal(transactions[0].date, '2026-09-01');
  assert.equal(transactions[0].account, 'Chase Checking');
  assert.equal(skipped.length, 2);
  assert.equal(skipped[0].reason, 'unparseable date');
  assert.equal(skipped[1].reason, 'unparseable amount');

  const inv = P.rowsToTransactions([['09/01/2026', 'Store', '19.99']], { date: 0, description: 1, amount: 2 }, { accountType: 'credit', invert: true });
  assert.equal(inv.transactions[0].amount, -19.99);
});
