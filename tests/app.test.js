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

test('stara stawka zapisana w bazie jest ignorowana przy wczytywaniu dłużników', () => {
  const load = read('app.js').match(/async function load\(\)[\s\S]*?\n\}/)[0];
  assert.match(load, /rate:0/);
  assert.ok(!/rate:\+d\.rate/.test(load), 'load() nie może przenosić stawki z bazy do obliczeń');
});
