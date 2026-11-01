// Uruchomienie: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../loans.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const loan = (date, amount) => ({ type: 'loan', date, amount });
const pay = (date, amount) => ({ type: 'pay', date, amount });

test('calc: brak wpisów daje zera', () => {
  const c = L.calc({ rate: 10, entries: [] }, '2026-06-01');
  assert.deepEqual([c.cap, c.int, c.owed, c.lent, c.paid], [0, 0, 0, 0, 0]);
});

test('calc: odsetki proste za 365 dni przy 12% to 12% kapitału', () => {
  const c = L.calc({ rate: 12, entries: [loan('2026-01-01', 1000)] }, '2027-01-01');
  near(c.cap, 1000); near(c.int, 120); near(c.owed, 1120);
});

test('calc: oprocentowanie 0% nie nalicza odsetek', () => {
  const c = L.calc({ rate: 0, entries: [loan('2020-01-01', 500)] }, '2026-01-01');
  assert.equal(c.int, 0); assert.equal(c.owed, 500);
});

test('calc: brak stopy (undefined) traktowany jak 0%', () => {
  const c = L.calc({ entries: [loan('2020-01-01', 500)] }, '2026-01-01');
  assert.equal(c.int, 0);
});

test('calc: spłata pokrywa najpierw odsetki, potem kapitał', () => {
  // 181 dni przy 10%: 1000 * 0.1/365 * 181 = 49,589...
  const c = L.calc({ rate: 10, entries: [loan('2026-01-01', 1000), pay('2026-07-01', 50)] }, '2026-07-01');
  near(c.int, 0);
  near(c.cap, 1000 - (50 - 1000 * 0.1 / 365 * 181), 0.005); // wynik w groszach: 999,59
  assert.equal(c.cap, 999.59);
  near(c.paid, 50);
});

test('calc: spłata mniejsza niż odsetki zmniejsza tylko odsetki', () => {
  const c = L.calc({ rate: 10, entries: [loan('2026-01-01', 1000), pay('2026-07-01', 10)] }, '2026-07-01');
  near(c.cap, 1000);
  near(c.int, 1000 * 0.1 / 365 * 181 - 10, 0.005); // wynik w groszach: 39,59
  assert.equal(c.int, 39.59);
});

test('calc: nadpłata daje ujemne owed i zerowy kapitał', () => {
  const c = L.calc({ rate: 0, entries: [loan('2026-01-01', 100), pay('2026-02-01', 150)] }, '2026-03-01');
  assert.equal(c.cap, 0); near(c.owed, -50);
});

test('calc: pożyczka i spłata w tym samym dniu - pożyczka liczona pierwsza', () => {
  const c = L.calc({ rate: 0, entries: [pay('2026-01-01', 100), loan('2026-01-01', 100)] }, '2026-01-01');
  assert.equal(c.cap, 0); assert.equal(c.owed, 0);
  assert.deepEqual(c.sorted.map(e => e.type), ['loan', 'pay']);
});

test('calc: wpisy są sortowane po dacie, wejście nie jest mutowane', () => {
  const entries = [pay('2026-03-01', 10), loan('2026-01-01', 100)];
  const c = L.calc({ rate: 0, entries }, '2026-03-02');
  assert.deepEqual(c.sorted.map(e => e.date), ['2026-01-01', '2026-03-01']);
  assert.equal(entries[0].type, 'pay');
});

test('calc: odsetki rosną tylko od kapitału, po całkowitej spłacie nie naliczają się', () => {
  const c = L.calc({ rate: 12, entries: [loan('2026-01-01', 100), pay('2026-01-01', 100)] }, '2027-01-01');
  assert.equal(c.owed, 0);
});

test('days: różnica dni przez zmianę czasu (DST) jest całkowita', () => {
  assert.equal(L.days('2026-03-28', '2026-03-30'), 2);
  assert.equal(L.days('2026-10-24', '2026-10-26'), 2);
});

test('monthlyPayment: bez oprocentowania dzieli równo', () => {
  near(L.monthlyPayment(1200, 0, 12), 100);
});

test('monthlyPayment: rata annuitetowa 12% / 12 mies. dla 1000 zł', () => {
  near(L.monthlyPayment(1000, 12, 12), 88.8488, 1e-3);
});

test('monthlyPayment: zero lub ujemna kwota daje 0, liczba rat min. 1', () => {
  assert.equal(L.monthlyPayment(0, 10, 12), 0);
  assert.equal(L.monthlyPayment(-5, 10, 12), 0);
  near(L.monthlyPayment(100, 0, 0), 100);
});

test('esc: ucieka znaki HTML', () => {
  assert.equal(L.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(L.esc(5), '5');
});

test('parseNotes: dłużnik z nagłówka, plus = pożyczka, minus = spłata', () => {
  const r = L.parseNotes('Jan Kowalski:\n01.10.2026 +500\n15.10.2026 -200 zł', false, 'Domyślny', '2026-11-01');
  assert.deepEqual(r.rows, [
    { who: 'Jan Kowalski', date: '2026-10-01', type: 'loan', amount: 500 },
    { who: 'Jan Kowalski', date: '2026-10-15', type: 'pay', amount: 200 },
  ]);
  assert.deepEqual(r.skip, []);
});

test('parseNotes: flip odwraca znaki', () => {
  const r = L.parseNotes('01.10.2026 +500\n02.10.2026 -50', true, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.type), ['pay', 'loan']);
});

test('parseNotes: kwota bez znaku to pożyczka, domyślny dłużnik i data', () => {
  const r = L.parseNotes('250', false, 'Ala', '2026-11-01');
  assert.deepEqual(r.rows, [{ who: 'Ala', date: '2026-11-01', type: 'loan', amount: 250 }]);
});

test('parseNotes: formaty kwot ze spacją i kropką jako separatorem tysięcy', () => {
  const r = L.parseNotes('01.10.2026 +1 000,50\n02.10.2026 +1.000,50\n03.10.2026 +12,5', false, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.amount), [1000.5, 1000.5, 12.5]);
});

test('parseNotes: data ISO i data z dwucyfrowym rokiem', () => {
  const r = L.parseNotes('2026-10-05 +10\n1.2.26 +20', false, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.date), ['2026-10-05', '2026-02-01']);
});

test('parseNotes: minus typograficzny (−, –) traktowany jak spłata', () => {
  const r = L.parseNotes('01.10.2026 −50\n02.10.2026 –60', false, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.type), ['pay', 'pay']);
});

test('parseNotes: linie bez kwoty trafiają do skip, a puste są ignorowane', () => {
  const r = L.parseNotes('---\n\n01.10.2026 +5', false, 'X', '2026-11-01');
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.skip, ['---']);
});

test('parseNotes: kwota zero jest pomijana', () => {
  const r = L.parseNotes('01.10.2026 +0', false, 'X', '2026-11-01');
  assert.equal(r.rows.length, 0);
  assert.equal(r.skip.length, 1);
});

// --- Poprawki błędów ---

test('localDate: dzień według czasu lokalnego, nie UTC', () => {
  process.env.TZ = 'Europe/Warsaw'; // 00:30 w Polsce to jeszcze poprzedni dzień w UTC
  assert.equal(L.localDate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
  assert.equal(L.localDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(L.localDate(new Date(2026, 2, 5)), '2026-03-05');
});

test('calc: szum zmiennoprzecinkowy nie daje fałszywej nadpłaty ani długu', () => {
  const c = L.calc({ rate: 0, entries: [loan('2026-01-01', 0.3), pay('2026-01-02', 0.1), pay('2026-01-03', 0.2)] }, '2026-02-01');
  assert.equal(c.owed, 0);
  assert.equal(c.cap, 0);
  assert.ok(Object.is(c.owed, 0), 'owed nie może być -0');
});

test('calc: wyniki są zaokrąglone do groszy', () => {
  const c = L.calc({ rate: 7, entries: [loan('2026-01-01', 1000)] }, '2026-04-01');
  for (const k of ['cap', 'int', 'owed', 'lent', 'paid']) {
    assert.equal(c[k], Math.round(c[k] * 100) / 100, k);
  }
});

test('calc: suma pożyczek o groszowych kwotach jest dokładna', () => {
  const c = L.calc({ rate: 0, entries: [loan('2026-01-01', 0.1), loan('2026-01-02', 0.2)] }, '2026-02-01');
  assert.equal(c.lent, 0.3);
  assert.equal(c.owed, 0.3);
});

test('parseNotes: nieistniejące daty trafiają do skip', () => {
  const r = L.parseNotes('32.13.2026 +100\n2026-02-30 +5\n31.04.2026 +7\n01.10.2026 +1', false, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.date), ['2026-10-01']);
  assert.equal(r.skip.length, 3);
});

test('parseNotes: 29 lutego tylko w roku przestępnym', () => {
  const r = L.parseNotes('29.02.2028 +1\n29.02.2026 +2', false, 'X', '2026-11-01');
  assert.deepEqual(r.rows.map(x => x.date), ['2028-02-29']);
  assert.equal(r.skip.length, 1);
});
