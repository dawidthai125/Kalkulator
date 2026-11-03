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

// --- Import w stylu notatki "kwota opis": dług bez znaku, spłaty w sekcjach, sumy pomijane ---
const P = (txt, opts, flip = false) => L.parseNotes(txt, flip, 'Znajomy', '2026-11-01', opts);

test('parseNotes: kwota z walutą bez znaku to dług, reszta linii to opis', () => {
  const r = P('1500 zł klej do wykładzin\n6000zl - płyty indukcyjne\nZUS 3421,80');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount, x.note]),
    [['loan', 1500, 'klej do wykładzin'], ['loan', 6000, 'płyty indukcyjne'], ['loan', 3421.8, 'ZUS']]);
});

test('parseNotes: sekcja "Faktury wpłaty:" to spłaty do pustej linii', () => {
  const r = P('Faktury wpłaty:\n24500 zł (27.05)\n20000 zł\n\n100 zł paliwo');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount, x.date]),
    [['pay', 24500, '2026-05-27'], ['pay', 20000, '2026-11-01'], ['loan', 100, '2026-11-01']]);
  assert.equal(r.skip.length, 0);
});

test('parseNotes: sekcja "Przelewy otrzymane" i minus przy kwocie z datą', () => {
  const r = P('Przelewy otrzymane w październiku\n38600 zł\n\nFaktura -21500 zł (19.06.2026r.)');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount, x.date, x.note || '']),
    [['pay', 38600, '2026-11-01', ''], ['pay', 21500, '2026-06-19', 'Faktura']]);
});

test('parseNotes: z kilku liczb wybiera kwotę z walutą', () => {
  const r = P('3 parapety 680 zł\nKamery 2 szt 740 zł\n600 zł - 12 szt nawiewników po 50 zł');
  assert.deepEqual(r.rows.map(x => x.amount), [680, 740, 600]);
});

test('parseNotes: pomija sumy, obliczenia, godziny, ułamki i nagłówki podsumowań', () => {
  const r = P('115 217 zł + 43 777zł = 186 994 zł\n45h wypłata\nRazem 3213 zł\nDo zapłaty 187 094 zł + 423h\nObornicka 20/2\nZaliczki Adam 150+50+50\nWycieraczki 60 i 40 Dacia');
  assert.equal(r.rows.length, 0);
  assert.equal(r.skip.length, 7);
});

test('parseNotes: nagłówek "Całość" wyłącza sekcję do pustej linii', () => {
  const r = P('Całość\n177 609 zł\n\n100 zł paliwo');
  assert.deepEqual(r.rows.map(x => x.amount), [100]);
  assert.equal(r.skip.length, 1);
});

test('parseNotes: mnożenie "45h x 40 = 1800 zł" daje wynik jako dług', () => {
  const r = P('Wypłata Dawid 45hx40 = 1800 zł\n45 x 40 = 1800');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount]), [['loan', 1800], ['loan', 1800]]);
});

test('parseNotes: kod "PIT-28" nie jest kwotą ze znakiem minus', () => {
  const r = P('PIT-28  6949,00');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount, x.note]), [['loan', 6949, 'PIT-28']]);
});

test('parseNotes: podsumowanie jako sam opis ("- koszty") jest pomijane', () => {
  const r = P('54900 zł  - koszty\n100 zł paliwo');
  assert.deepEqual(r.rows.map(x => x.amount), [100]);
  assert.equal(r.skip.length, 1);
});

test('parseNotes: headersAsDebtors=false ignoruje nagłówki i zostawia dłużnika', () => {
  const r = P('Gotówka wypłacona :\n25000 zł', { headersAsDebtors: false });
  assert.deepEqual(r.rows.map(x => [x.who, x.amount]), [['Znajomy', 25000]]);
  assert.equal(r.skip.length, 0);
});

test('parseNotes: domyślnie nagłówek bez kwoty to dłużnik (zgodność wstecz)', () => {
  const r = P('Jan:\n100 zł x');
  assert.equal(r.rows[0].who, 'Jan');
});

test('parseNotes: data bez roku z przyszłości dostaje rok poprzedni', () => {
  const r = P('15.12 100 zł\n10.03 50 zł');
  assert.deepEqual(r.rows.map(x => x.date), ['2025-12-15', '2026-03-10']);
});

test('parseNotes: format eksportu (data, znak, kwota, opis z cyframi) wraca bez zmian', () => {
  const r = P('15.10.2026 +500,00 przelew za 3 raty\n16.10.2026 -200,00 zwrot');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount, x.date, x.note]),
    [['loan', 500, '2026-10-15', 'przelew za 3 raty'], ['pay', 200, '2026-10-16', 'zwrot']]);
});

test('parseNotes: linie z samymi godzinami liczą się jako godziny × stawka z notatki', () => {
  const r = P('45h wypłata\n45 x 40 = 1800\n27h (sr,czw)\nGodziny przed nowym rokiem 24\nWypłata 24h 960 zł');
  assert.deepEqual(r.rows.map(x => [x.type, x.amount]), [['loan', 1800], ['loan', 1800], ['loan', 1080], ['loan', 960], ['loan', 960]]);
  assert.equal(r.rows[0].note, '45h wypłata (× 40 zł/h)');
  assert.deepEqual(r.hours, { rate: 40, lines: 3 });
});

test('parseNotes: stawka z opcji ma pierwszeństwo, a bez stawki godziny są pomijane', () => {
  assert.equal(P('45h wypłata\n45 x 40 = 1800', { hourlyRate: 50 }).rows[0].amount, 2250);
  const r = P('45h wypłata');
  assert.equal(r.rows.length, 0); assert.equal(r.skip.length, 1);
});

test('parseNotes: defaultDate dostają tylko wpisy bez daty, a data bez roku liczy się od dziś', () => {
  const r = P('100 zł paliwo\n24500 zł (27.05)\n50 zł 03.10.2026', { defaultDate: '2026-05-08' });
  assert.deepEqual(r.rows.map(x => x.date), ['2026-05-08', '2026-05-27', '2026-10-03']);
  assert.equal(P('100 zł x', { defaultDate: '2026-02-30' }).rows[0].date, '2026-11-01');
});

// --- Zdarzenia logowania Supabase ---

test('authTransition: to samo konto (powrót do karty, odświeżenie tokenu) nie wymaga przeładowania', () => {
  assert.equal(L.authTransition({ id: 'a' }, { id: 'a', email: 'nowy@x.pl' }), 'same');
});

test('authTransition: pierwsze logowanie i zmiana konta ładują dane', () => {
  assert.equal(L.authTransition(null, { id: 'a' }), 'login');
  assert.equal(L.authTransition({ id: 'a' }, { id: 'b' }), 'login');
});

// --- Duplikaty w imporcie i odświeżanie ---

test('markDuplicates: ta sama data, rodzaj i kwota co istniejący wpis to duplikat (z licznością)', () => {
  const existing = { jan: [{ date: '2026-10-01', type: 'loan', amount: 500 }] };
  const rows = [
    { who: 'Jan', date: '2026-10-01', type: 'loan', amount: 500 },
    { who: 'Jan', date: '2026-10-01', type: 'loan', amount: 500.0 }, // drugi taki sam: istnieje tylko jeden, więc ten jest nowy
    { who: 'Jan', date: '2026-10-02', type: 'loan', amount: 500 },
    { who: 'Jan', date: '2026-10-01', type: 'pay', amount: 500 },
    { who: 'Ala', date: '2026-10-01', type: 'loan', amount: 500 },
  ];
  const r = L.markDuplicates(rows, who => existing[who.toLowerCase()] || []);
  assert.deepEqual(r.map(x => x.dup), [true, false, false, false, false]);
  assert.equal(rows[0].dup, undefined, 'wejście nie jest mutowane');
});

test('markDuplicates: kwoty porównywane co do grosza, a pusta lista istniejących nic nie oznacza', () => {
  const r = L.markDuplicates([{ who: 'X', date: '2026-01-01', type: 'pay', amount: 10.1 }], () => [{ date: '2026-01-01', type: 'pay', amount: 10.10000001 }]);
  assert.equal(r[0].dup, true);
  assert.equal(L.markDuplicates([{ who: 'X', date: '2026-01-01', type: 'pay', amount: 1 }], () => [])[0].dup, false);
});

test('shouldRefresh: tylko widoczna karta, zalogowany, bez wpisywania i nie częściej niż co minMs', () => {
  const ok = { hidden: false, loggedIn: true, busy: false, typing: false, last: 0, now: 30000, minMs: 20000 };
  assert.equal(L.shouldRefresh(ok), true);
  for (const bad of [{ hidden: true }, { loggedIn: false }, { busy: true }, { typing: true }, { now: 10000 }]) {
    assert.equal(L.shouldRefresh({ ...ok, ...bad }), false, JSON.stringify(bad));
  }
});

// --- Powiadomienia push ---

test('urlBase64ToUint8Array: klucz base64url (bez dopełnienia) na bajty, jak wymaga PushManager.subscribe', () => {
  assert.deepEqual([...L.urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...L.urlBase64ToUint8Array('_-8')], [255, 239], 'znaki - i _ oraz brak dopełnienia');
  const key = 'BJJ7Y9ZK7JOzncnT_9TEijdetZ9B0q0fV1vIsa4rzaUtbHsEyqyCPYc7BtHAKi_h91nFvV7WVQqVArXVpC2ybvs';
  const b = L.urlBase64ToUint8Array(key);
  assert.ok(b instanceof Uint8Array); assert.equal(b.length, 65, 'klucz publiczny P-256 ma 65 bajtów'); assert.equal(b[0], 4, 'nieskompresowany punkt');
});

// --- Tryb offline ---

test('isNetworkError: rozpoznaje brak połączenia w Chrome, Firefox i Safari', () => {
  for (const m of ['TypeError: Failed to fetch', 'Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed', 'The Internet connection appears to be offline.']) {
    assert.equal(L.isNetworkError({ message: m }), true, m);
  }
  assert.equal(L.isNetworkError('TypeError: Failed to fetch'), true, 'sam napis też');
});

test('isNetworkError: błędy logiczne (hasło, uprawnienia, walidacja) to nie brak sieci', () => {
  for (const m of ['Invalid login credentials', 'Brak dostępu.', 'Kwota musi być większa od zera.', 'JWT expired', 'permission denied for table entries']) {
    assert.equal(L.isNetworkError({ message: m }), false, m);
  }
  assert.equal(L.isNetworkError(null), false);
  assert.equal(L.isNetworkError({}), false);
});

// --- Dostęp dłużnika (login, sposoby płatności, statusy zgłoszeń) ---

test('loginToEmail: login bez @ dostaje techniczny adres, e-mail zostaje (małe litery)', () => {
  assert.equal(L.loginToEmail(' Zosia '), 'zosia@dluznik.invalid');
  assert.equal(L.loginToEmail('e2e-zosia'), 'e2e-zosia@dluznik.invalid');
  assert.equal(L.loginToEmail('Dawid.Thai@int.pl'), 'dawid.thai@int.pl');
  assert.equal(L.loginToEmail('   '), '');
});

test('validLogin: tak samo jak w bazie (3-30 znaków, małe litery, cyfry, . _ -)', () => {
  for (const ok of ['zosia', 'e2e-zosia', 'jan.k_1', 'a1b']) assert.equal(L.validLogin(ok), true, ok);
  for (const bad of ['zo', 'Zosia', 'zosia!', '-zosia', 'zosię', 'jan kowalski', 'a'.repeat(31), '', 'a@b.pl']) assert.equal(L.validLogin(bad), false, bad);
});

test('methodLabel i statusLabel: polskie etykiety, nieznane wartości bez błędu', () => {
  assert.deepEqual(['blik', 'przelew', 'gotowka', 'inne'].map(L.methodLabel), ['BLIK', 'Przelew', 'Gotówka', 'Inna forma']);
  assert.equal(L.methodLabel('xyz'), 'Inna forma');
  assert.deepEqual(['pending', 'approved', 'rejected'].map(L.statusLabel), ['Czeka na akceptację', 'Zaakceptowana', 'Odrzucona']);
  assert.equal(L.statusLabel('xyz'), 'xyz');
});

// --- Rozliczenie dla dłużnika (eksport PDF) ---

test('datePL: RRRR-MM-DD na DD.MM.RRRR, a puste lub błędne zostaje bez zmian', () => {
  assert.equal(L.datePL('2026-11-03'), '03.11.2026');
  assert.equal(L.datePL(''), '');
  assert.equal(L.datePL('wczoraj'), 'wczoraj');
});

test('settlement: dzieli wpisy na długi i spłaty, sortuje po dacie i sumuje', () => {
  const d = { rate: 0, entries: [
    pay('2026-03-01', 100), loan('2026-02-01', 500), loan('2026-01-01', 250.5), pay('2026-02-15', 50),
  ] };
  const s = L.settlement(d, '2026-04-01');
  assert.deepEqual(s.loans.map(x => x.date), ['2026-01-01', '2026-02-01']);
  assert.deepEqual(s.pays.map(x => x.date), ['2026-02-15', '2026-03-01']);
  assert.equal(s.lent, 750.5); assert.equal(s.paid, 150);
  assert.equal(s.due, 600.5); assert.equal(s.status, 'debt');
});

test('settlement: opis wpisu trafia do wiersza, brak opisu to pusty napis', () => {
  const s = L.settlement({ rate: 0, entries: [{ type: 'loan', date: '2026-01-01', amount: 10, note: 'Syfon' }, loan('2026-01-02', 5)] }, '2026-02-01');
  assert.deepEqual(s.loans.map(x => x.note), ['Syfon', '']);
});

test('settlement: status rozliczone (0 zł) i nadpłata (kwota dodatnia, status over)', () => {
  const settled = L.settlement({ rate: 0, entries: [loan('2026-01-01', 100), pay('2026-01-02', 100)] }, '2026-02-01');
  assert.equal(settled.status, 'settled'); assert.equal(settled.due, 0);
  const over = L.settlement({ rate: 0, entries: [loan('2026-01-01', 100), pay('2026-01-02', 130)] }, '2026-02-01');
  assert.equal(over.status, 'over'); assert.equal(over.due, 30);
});

test('settlement: dłużnik bez wpisów nie powoduje błędu', () => {
  const s = L.settlement({ rate: 0, entries: [] }, '2026-02-01');
  assert.deepEqual([s.loans.length, s.pays.length, s.lent, s.paid, s.due, s.status], [0, 0, 0, 0, 0, 'settled']);
});

// --- Pole kwoty przyjmuje tylko liczby ---

test('numOnly: litery i inne znaki są odrzucane, zostaje sama liczba', () => {
  assert.equal(L.numOnly('148 Syfon'), '148');
  assert.equal(L.numOnly('Syfon'), '');
  assert.equal(L.numOnly('-5'), '5');
  assert.equal(L.numOnly('1 000'), '1000');
  assert.equal(L.numOnly('12 zł'), '12');
  assert.equal(L.numOnly(''), '');
});

test('numOnly: jeden separator dziesiętny (przecinek lub kropka) i najwyżej 2 miejsca po nim', () => {
  assert.equal(L.numOnly('250,5'), '250,5');
  assert.equal(L.numOnly('250.50'), '250.50');
  assert.equal(L.numOnly('12,345'), '12,34');
  assert.equal(L.numOnly('1,2,3'), '1,2');
  assert.equal(L.numOnly('1.2.3'), '1.2');
  assert.equal(L.numOnly(',5'), ',5');
});

test('numOnly: wynik zawsze daje się sparsować jak kwota w app.js', () => {
  for (const s of ['148', '250,5', '250.50', ',5']) {
    assert.ok(parseFloat(L.numOnly(s).replace(',', '.')) > 0, s);
  }
});

test('authTransition: brak sesji to wylogowanie', () => {
  assert.equal(L.authTransition({ id: 'a' }, null), 'logout');
  assert.equal(L.authTransition(null, null), 'logout');
});
