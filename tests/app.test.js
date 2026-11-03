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

test('eksport PDF: przycisk, dokument z rozliczeniem i druk', () => {
  const app = read('app.js');
  assert.match(app, /id="pdfExp"/, 'brak przycisku eksportu PDF');
  assert.match(app, /Loans\.settlement\(/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /host\.id='pdfdoc'/, 'dokument do druku musi mieć własny kontener #pdfdoc');
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
  const load = read('app.js').match(/async function load\(\)[\s\S]*?\n\}/)[0];
  assert.match(load, /rate:0/);
  assert.ok(!/rate:\+d\.rate/.test(load), 'load() nie może przenosić stawki z bazy do obliczeń');
});
