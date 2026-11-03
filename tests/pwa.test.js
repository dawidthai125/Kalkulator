// Statyczne kontrole instalacji na telefonie (PWA) i trybu offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

test('manifest: nazwa, id, tryb samodzielny, ikony (w tym maskowalna) i opis', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.id && m.name && m.short_name && m.start_url && m.description, 'brak id/name/short_name/start_url/description');
  assert.equal(m.lang, 'pl');
  const sizes = m.icons.map(i => i.sizes + ':' + (i.purpose || 'any'));
  assert.ok(sizes.includes('192x192:any'), 'ikona 192');
  assert.ok(sizes.includes('512x512:any'), 'ikona 512');
  assert.ok(sizes.includes('512x512:maskable'), 'ikona maskowalna 512 (Android przycina ikony)');
  for (const i of m.icons) assert.ok(exists(i.src), 'brak pliku ikony ' + i.src);
});

test('service worker: powłoka aplikacji jest w cache, a pliki z listy istnieją', () => {
  const sw = read('sw.js');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const f of ['index.html', 'app.js', 'loans.js', 'vendor/supabase.js', 'manifest.webmanifest']) assert.ok(shell.includes(f), f + ' w SHELL');
  for (const f of shell) if (f !== './') assert.ok(exists(f), 'brak pliku z listy SHELL: ' + f);
});

test('service worker: nie dotyka danych (tylko GET z własnej domeny), jest network-first z limitem czasu', () => {
  const sw = read('sw.js');
  assert.match(sw, /r\.method !== 'GET' \|\| u\.origin !== location\.origin\) return/, 'API Supabase i czcionki mają iść prosto do sieci');
  assert.ok(!/supabase\.co/.test(sw), 'worker nie zna adresu API');
  assert.match(sw, /timeout\(fetch\(r\)/, 'limit czasu przy słabej sieci');
  assert.match(sw, /caches\.delete/, 'sprzątanie starych wersji cache');
});

test('aplikacja rejestruje service workera', () => {
  assert.match(read('app.js'), /serviceWorker\.register\('sw\.js'\)/);
});

test('tryb offline: ostatni stan jest zapisywany, odczytywany tylko dla tego samego konta i czyszczony przy wylogowaniu', () => {
  const app = read('app.js');
  assert.match(app, /function snapSave\(/); assert.match(app, /function snapLoad\(/); assert.match(app, /function snapClear\(/);
  assert.match(app, /s\.uid===S\.user\.id/, 'migawka musi należeć do zalogowanego konta');
  const authHandler = app.slice(app.indexOf('onAuthStateChange'));
  assert.match(authHandler, /snapClear\(\)/, 'wylogowanie czyści migawkę');
  assert.match(app, /Loans\.isNetworkError\(/);
});

test('tryb offline: baner z godziną danych i ponowieniem, a błąd sieci ma ludzki komunikat', () => {
  const app = read('app.js');
  assert.match(app, /Tryb offline/); assert.match(app, /id="retry"/);
  assert.match(app, /addEventListener\('online'/, 'po powrocie sieci dane odświeżają się same');
  assert.match(app, /Brak połączenia z internetem/);
});

test('instalacja: karta „Zainstaluj aplikację” (Android) i instrukcja dla iPhone, z możliwością ukrycia', () => {
  const app = read('app.js');
  assert.match(app, /beforeinstallprompt/); assert.match(app, /id="instBtn"/); assert.match(app, /id="instNo"/);
  assert.match(app, /Dodaj do ekranu początkowego/);
  assert.match(app, /display-mode: standalone/, 'w zainstalowanej aplikacji karta się nie pokazuje');
});

test('CSP i nagłówki pozwalają na service workera bez osłabiania zabezpieczeń', () => {
  const v = JSON.parse(read('vercel.json')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(v, /script-src 'self'(;|$)/); assert.ok(!/unsafe-eval/.test(v));
  assert.ok(!/worker-src\s+\*/.test(v));
});
