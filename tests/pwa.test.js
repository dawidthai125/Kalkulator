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

test('push: service worker pokazuje powiadomienie i otwiera aplikację po kliknięciu', () => {
  const sw = read('sw.js');
  assert.match(sw, /addEventListener\('push'/); assert.match(sw, /showNotification\(/);
  assert.match(sw, /addEventListener\('notificationclick'/); assert.match(sw, /openWindow\(/); assert.match(sw, /\.focus\(\)/);
  assert.match(sw, /e\.data\.json\(\)/, 'ładunek JSON z tytułem i treścią');
});

test('push: włączanie z gestu użytkownika, subskrypcja widoczna, zapis przez RPC, klucz z funkcji serwerowej', () => {
  const app = read('app.js');
  const on = app.match(/async function pushEnable\(\)[\s\S]*?\n\}/)[0];
  assert.ok(on.indexOf('Notification.requestPermission') < on.indexOf('await pushKey'), 'najpierw zgoda (gest użytkownika), potem reszta');
  assert.match(on, /userVisibleOnly:true/); assert.match(on, /Loans\.urlBase64ToUint8Array\(/);
  assert.match(on, /SB\.rpc\('save_push_subscription'/);
  assert.match(app, /action:'key'/);
  assert.match(app, /id="pushOn"/); assert.match(app, /id="pushOff"/);
  assert.match(app, /Dodaj do ekranu początkowego|dodaj aplikację do ekranu głównego/i, 'iPhone: najpierw instalacja');
});

test('push: wylogowanie najpierw kasuje subskrypcję tego urządzenia (bez cudzych powiadomień na wspólnym telefonie)', () => {
  const app = read('app.js');
  const logout = app.match(/id==='logout'\)\{[^\n]*\}/)[0];
  assert.ok(logout.indexOf('pushCleanup') >= 0 && logout.indexOf('pushCleanup') < logout.indexOf('signOut'), logout);
  assert.match(app, /async function pushCleanup\(/);
});

test('push: powiadomienia po zgłoszeniu spłaty (do właściciela) i po decyzji (do dłużnika)', () => {
  const app = read('app.js');
  assert.match(app, /notifyPush\('request',/); assert.match(app, /notifyPush\('decision',/);
  assert.match(app, /function notifyPush\(/);
});

test('push: funkcja serwerowa sprawdza uprawnienia, wysyła najwyżej raz i nie ujawnia klucza prywatnego', () => {
  const fn = read('supabase/functions/send-push/index.ts');
  assert.match(fn, /\.eq\('requested_by', caller\)/); assert.match(fn, /\.eq\('owner_id', caller\)/);
  assert.match(fn, /\.is\('notified_at', null\)/); assert.match(fn, /\.is\('decision_notified_at', null\)/);
  assert.match(fn, /code === 404 \|\| code === 410/, 'wygasłe subskrypcje są sprzątane');
  for (const m of fn.matchAll(/json\(\{[^}]*\}/g)) assert.ok(!/private_key/.test(m[0]), 'odpowiedź nie może zawierać klucza prywatnego: ' + m[0]);
  assert.ok(!/BEGIN (EC )?PRIVATE KEY/.test(fn));
});

test('push: treść powiadomienia jest ogólna (bez imienia i kwoty na ekranie blokady)', () => {
  const fn = read('supabase/functions/send-push/index.ts');
  assert.ok(!/money\.format/.test(fn), 'kwota nie może trafiać do treści');
  assert.ok(!/d\?\.name/.test(fn), 'imię dłużnika nie może trafiać do treści');
  assert.match(fn, /Otwórz aplikację, aby zobaczyć szczegóły/);
});

test('historia i błędy: migracja loguje zmiany triggerem, ukrywa dziennik przed zapisem i limituje zgłoszenia błędów', () => {
  const sql = read('supabase/migrations/20261103_audit_and_errors.sql');
  assert.match(sql, /create trigger entries_log after insert or update or delete on public\.entries/);
  assert.match(sql, /revoke insert, update, delete on public\.entry_log from authenticated/);
  assert.match(sql, /using \(owner_id = \(select auth\.uid\(\)\)\)/, 'właściciel czyta tylko własny dziennik');
  assert.match(sql, /not exists \(select 1 from auth\.users where id = owner\)/, 'kasowanie konta właściciela nie może się wywalić na dzienniku');
  assert.match(sql, /revoke all on public\.client_errors from anon, authenticated/);
  assert.match(sql, />= 30/, 'limit zgłoszeń błędów na godzinę');
});

test('push: migracja ukrywa klucze VAPID i nie pozwala zapisywać subskrypcji bezpośrednio', () => {
  const sql = read('supabase/migrations/20261103_push_notifications.sql');
  assert.match(sql, /alter table public\.push_config enable row level security/);
  assert.match(sql, /revoke all on public\.push_config from anon, authenticated/);
  assert.match(sql, /revoke insert, update on public\.push_subscriptions from authenticated/);
  assert.match(sql, /security definer/);
});

test('CSP i nagłówki pozwalają na service workera bez osłabiania zabezpieczeń', () => {
  const v = JSON.parse(read('vercel.json')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(v, /script-src 'self'(;|$)/); assert.ok(!/unsafe-eval/.test(v));
  assert.ok(!/worker-src\s+\*/.test(v));
});

test('Android (TWA): assetlinks.json wskazuje pakiet z manifestu aplikacji, a klucze nie trafiają do repozytorium', () => {
  const links = JSON.parse(read('.well-known/assetlinks.json'));
  const t = links[0].target;
  assert.equal(t.namespace, 'android_app');
  assert.match(t.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.ok(manifest.includes('https://dluznik.vercel.app/'), 'adres strony');
  assert.match(read('android/app/build.gradle'), new RegExp("applicationId '" + t.package_name.replace(/\./g, '\\.') + "'"));
  assert.match(read('android/.gitignore'), /\*\.jks/); assert.match(read('android/.gitignore'), /\*\.apk/);
  assert.ok(!/storePassword\s+['"]/.test(read('android/app/build.gradle')), 'hasło klucza nie może być w repozytorium');
});
