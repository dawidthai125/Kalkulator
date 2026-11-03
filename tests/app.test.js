// Statyczne kontrole zachowania aplikacji (app.js nie da się uruchomić w Node bez DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('zdarzenia logowania tego samego konta nie przerysowują formularza (kasowały wpisaną kwotę)', () => {
  const app = read('app.js');
  const handler = app.slice(app.indexOf('onAuthStateChange'));
  assert.match(handler, /Loans\.authTransition\(/);
  assert.match(handler, /==='same'/, 'przy "same" handler musi wyjść bez load()/render()');
});

test('aplikacja nie liczy ani nie pokazuje oprocentowania (pożyczki bez procentu)', () => {
  const ui = read('app.js') + read('index.html');
  assert.ok(!/Oprocentowanie/i.test(ui), 'pole oprocentowania nie powinno być w interfejsie');
  assert.ok(!/Naliczone odsetki/.test(ui), 'kafelek odsetek nie powinien być w interfejsie');
  assert.ok(!/id="rt"/.test(ui), 'pole #rt nie powinno istnieć');
});

test('zalogowany użytkownik może zmienić hasło (przycisk w pasku i karta, także bez dłużników)', () => {
  const app = read('app.js');
  assert.match(app, /id="pwToggle"/, 'brak przycisku otwierającego zmianę hasła');
  assert.match(app, /id="chpw"/, 'brak przycisku zapisu nowego hasła');
  const noDebtor = app.match(/if\(!d\)\{p\.innerHTML=[^\n]*\}/)[0];
  assert.match(noDebtor, /pwCard\(\)/, 'karta hasła musi być też w widoku bez dłużników');
  const click = app.slice(app.indexOf("id==='setpw'"));
  assert.match(click, /length<8/, 'minimum 8 znaków');
});

test('tekstowe pola kwoty (szybkie dopisanie, pominięte linie importu) przyjmują tylko liczby', () => {
  const app = read('app.js');
  const input = app.slice(app.indexOf("document.addEventListener('input'"));
  assert.match(input, /Loans\.numOnly\(/);
  assert.match(input, /id==='qa'/, 'filtr musi obejmować pole szybkiej kwoty #qa');
  assert.match(input, /sk-am/, 'filtr musi obejmować kwoty pominiętych linii importu');
});

test('dostęp dłużnika: logowanie loginem, rola z bazy, widok dłużnika i zgłoszenie spłaty', () => {
  const app = read('app.js');
  assert.match(app, /Loans\.loginToEmail\(/, 'logowanie loginem (bez e-maila)');
  assert.match(app, /SB\.rpc\('debtor_overview'/, 'rola wynika z bazy, nie z danych użytkownika');
  assert.match(app, /SB\.rpc\('submit_repayment'/);
  assert.match(app, /function renderDebtor\(/);
  assert.match(app, /id="dSend"/);
  assert.match(app, /Wyślij do akceptacji/);
});

test('dostęp dłużnika: właściciel zakłada konto funkcją serwerową i akceptuje zgłoszenia', () => {
  const app = read('app.js');
  assert.match(app, /SB\.functions\.invoke\('manage-debtor-login'/);
  for (const a of ['create', 'reset', 'delete']) assert.ok(app.includes("'" + a + "'"), 'akcja ' + a);
  assert.match(app, /SB\.rpc\('decide_repayment'/);
  assert.match(app, /data-rapprove=/); assert.match(app, /data-rreject=/);
  assert.match(app, /id="acCreate"/);
});

test('dostęp dłużnika: dane z bazy (nazwy, opisy, powody) są escapowane w nowych widokach', () => {
  const app = read('app.js');
  const views = ['function renderDebtor', 'function reqHtml', 'function accessCard'].map(f => app.slice(app.indexOf(f), app.indexOf(f) + 4500)).join('\n');
  for (const v of ['m.name', 'm.login', 'r.note', 'r.decision_note', 'e.note', 'd.access']) {
    assert.ok(views.includes('esc(' + v), 'brak esc() dla ' + v);
  }
});

test('dostęp dłużnika: ekran ładowania zamiast chwilowego widoku właściciela', () => {
  const render = read('app.js').match(/function render\(\)[\s\S]*?\n\}/)[0];
  assert.match(render, /if\(!S\.role\)/, 'bez roli pokazujemy "Ładowanie", żeby dłużnik nie zobaczył widoku właściciela');
  assert.match(render, /S\.role==='debtor'/);
});

test('dostęp dłużnika: kwota zgłoszenia przyjmuje tylko liczby', () => {
  const app = read('app.js');
  const input = app.slice(app.indexOf("document.addEventListener('input'"));
  assert.match(input, /id==='dq'/);
});

test('odświeżanie po powrocie: widoczność karty, okresowo, bez gubienia wpisywanego tekstu', () => {
  const app = read('app.js');
  assert.match(app, /addEventListener\('visibilitychange'/); assert.match(app, /setInterval\(softRefresh/);
  assert.match(app, /Loans\.shouldRefresh\(/); assert.match(app, /load\(\{soft:true\}\)/);
  const soft = app.match(/async function softRefresh\(\)[\s\S]*?\n\}/)[0];
  assert.match(soft, /hasDraft\(\)/, 'wpisany niezapisany tekst blokuje odświeżenie');
  const load = app.match(/async function load\([\s\S]*?\n\}/)[0];
  assert.match(load, /JSON\.stringify/, 'bez zmian w danych nie przerysowujemy widoku');
});

test('usuwanie wpisu pyta o potwierdzenie', () => {
  const app = read('app.js');
  const del = app.match(/else if\(t\.dataset\.del&&d\)\{[^\n]*\}/)[0];
  assert.match(del, /confirm\(/);
  assert.ok(del.indexOf('confirm(') < del.indexOf("from('entries').delete()"), 'najpierw pytanie, potem usunięcie');
});

test('import: wykrywa duplikaty, pozwala je pominąć i liczy tylko to, co faktycznie trafi na listę', () => {
  const app = read('app.js');
  assert.match(app, /Loans\.markDuplicates\(/); assert.match(app, /id="skipdup"/); assert.match(app, /już jest/);
  const doImp = app.slice(app.indexOf("id==='doImp'"), app.indexOf("id==='pdfExp'"));
  assert.match(doImp, /impActive\(\)/, 'import bierze pod uwagę pomijanie duplikatów');
});

test('PDF dla dłużnika: przycisk w widoku dłużnika korzysta z tego samego dokumentu co właściciel', () => {
  const app = read('app.js');
  assert.match(app, /id="dPdf"/); assert.match(app, /function printSettlement\(/);
  const debtorView = app.match(/function renderDebtor\(\)[\s\S]*?\n\}/)[0];
  assert.match(debtorView, /id="dPdf"/);
  assert.match(app, /id==='dPdf'/);
});

test('konto dłużnika z odebranym dostępem jest wylogowywane zamiast pokazywać widok właściciela', () => {
  const load = read('app.js').match(/async function load\([\s\S]*?\n\}/)[0];
  assert.match(load, /role==='debtor'/); assert.match(load, /signOut\(\)/); assert.match(load, /Dostęp do tego konta został wyłączony/);
});

test('zmiana hasła zachowuje znacznik roli konta dłużnika', () => {
  assert.match(read('app.js'), /updateUser\(\{password:p1,data:\{must_change_password:false,role:/);
});

test('widok dłużnika ma informację o prywatności', () => {
  const debtorView = read('app.js').match(/function renderDebtor\(\)[\s\S]*?\n\}/)[0];
  assert.match(debtorView, /Prywatność/); assert.match(debtorView, /Frankfurt/);
});

test('historia zmian: właściciel wczytuje dziennik zmian wpisów dłużnika na żądanie, dane są escapowane', () => {
  const app = read('app.js');
  assert.match(app, /id="logShow"/); assert.match(app, /id="logBox"/);
  const h = app.slice(app.indexOf("id==='logShow'"), app.indexOf("id==='logShow'") + 1200);
  assert.match(h, /from\('entry_log'\)/); assert.match(h, /\.eq\('debtor_id',d\.id\)/); assert.match(h, /\.limit\(50\)/);
  assert.match(h, /Loans\.describeLog\(/); assert.match(h, /esc\(ds\.text\)/);
});

test('monitoring błędów: nieobsłużone błędy trafiają do bazy z limitem i bez szumu sieciowego', () => {
  const app = read('app.js');
  const rep = app.match(/function reportError\([\s\S]*?\n\}/)[0];
  assert.match(rep, /errSent>=5/, 'najwyżej 5 zgłoszeń na wczytanie strony');
  assert.match(rep, /errSeen\[msg\]/, 'ten sam błąd nie jest zgłaszany ponownie');
  assert.match(rep, /isNetworkError/, 'brak internetu to nie błąd aplikacji');
  assert.match(rep, /S\.user/, 'tylko zalogowani (baza i tak odrzuca anonimowych)');
  assert.match(rep, /log_client_error/);
  assert.match(app, /addEventListener\('error'/); assert.match(app, /addEventListener\('unhandledrejection'/);
});

test('eksport PDF: przycisk, dokument z rozliczeniem i druk', () => {
  const app = read('app.js');
  assert.match(app, /id="pdfExp"/, 'brak przycisku eksportu PDF');
  assert.match(app, /Loans\.settlement\(/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /host\.id='pdfdoc'/, 'dokument do druku musi mieć własny kontener #pdfdoc');
});

test('eksport PDF: stopka z podpisem autora i hasłem o odzyskiwaniu pieniążków', () => {
  const doc = read('app.js').match(/function pdfHtml\([\s\S]*?\n\}/)[0];
  const foot = doc.slice(doc.indexOf('<footer'));
  assert.match(foot, /System <b>Dłużnik 2\.0<\/b> stworzony przez <b>Dawida Thai Thanh<\/b>/);
  assert.match(foot, /na potrzeby odzyskania pieniążków, założonych, pożyczonych i w ogóle :D/);
  assert.match(foot, /Zestawienie ma charakter informacyjny/, 'adnotacja informacyjna zostaje');
});

test('eksport PDF: dane wpisane przez użytkownika są escapowane w dokumencie', () => {
  const app = read('app.js');
  const doc = app.match(/function pdfHtml\([\s\S]*?\n\}/)[0];
  for (const v of ['d.name', 'x.note', 'o.msg', 'o.acct']) {
    assert.ok(doc.includes('esc(' + v), 'brak esc() dla ' + v);
  }
  assert.ok(!/<script/i.test(doc), 'dokument nie może zawierać skryptów');
});

test('eksport PDF: arkusz druku (A4, ukrycie reszty strony, stopka, numeracja stron)', () => {
  const html = read('index.html');
  assert.match(html, /@page\s*\{[^}]*A4/);
  assert.match(html, /@media print/);
  assert.match(html, /body>\*:not\(#pdfdoc\)\{display:none/, 'w druku ma być tylko dokument');
  assert.match(html, /@bottom-center\{content:"Strona " counter\(page\)/, 'numeracja stron');
  assert.match(html, /\.pdf-foot\s*\{/);
  // stopka przypięta do marginesu (position:fixed) wypychała pustą drugą stronę, więc ma być w przepływie
  assert.ok(!/\.pdf-foot\s*\{[^}]*position:\s*fixed/.test(html), 'stopka nie może być position:fixed');
  assert.match(html, /\.pdf-t\s*\{[^}]*table-layout:fixed/, 'stałe szerokości kolumn, bo długi opis ucinał kwotę');
  assert.match(html, /\.pdf-t td\s*\{[^}]*white-space:normal/, 'komórki muszą się zawijać (globalne th,td ma nowrap)');
});

test('stara stawka zapisana w bazie jest ignorowana przy wczytywaniu dłużników', () => {
  const load = read('app.js').match(/async function load\([^)]*\)[\s\S]*?\n\}/)[0];
  assert.match(load, /rate:0/);
  assert.ok(!/rate:\+d\.rate/.test(load), 'load() nie może przenosić stawki z bazy do obliczeń');
});

test('kopia zapasowa: karta z JSON, CSV i przywracaniem, z potwierdzeniem, limitem pliku i datą ostatniej kopii', () => {
  const fs = require('node:fs'), app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  for (const id of ['bkJson', 'bkCsv', 'bkfile', 'bkOut', 'bkRestore']) assert.ok(app.includes(id), id);
  assert.match(app, /Loans\.buildBackup\(/); assert.match(app, /Loans\.parseBackup\(/); assert.match(app, /Loans\.planRestore\(/);
  assert.match(app, /f\.size>5000000/); assert.match(app, /Ostatnia kopia/);
  const restore = app.match(/id==='bkRestore'[\s\S]*?BKPLAN=null;await load/)[0];
  assert.ok(restore.indexOf('confirm(') >= 0 && restore.indexOf('confirm(') < restore.indexOf('.insert('), 'najpierw potwierdzenie');
  assert.ok(!/\.delete\(\)|\.update\(/.test(restore), 'przywracanie tylko dodaje');
});

test('przypomnienie dla dłużnika: karta z tekstem do edycji, udostępnianiem i kopiowaniem, bez wysyłania automatycznego', () => {
  const fs = require('node:fs'), app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  for (const id of ['rmdue', 'rmacct', 'rmtxt', 'rmShare', 'rmCopy']) assert.ok(app.includes(id), id);
  assert.match(app, /Loans\.reminderText\(/);
  const block = app.match(/id==='rmShare'[\s\S]*?\n  \}/)[0];
  assert.ok(!/SB\./.test(block), 'udostępnianie nie dotyka bazy');
});
