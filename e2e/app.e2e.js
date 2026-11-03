// Testy przeglądarki (Chromium) z atrapą Supabase. Uruchomienie: npm ci && npx playwright install chromium && node --test app.e2e.js
// Serwer testowy podaje pliki aplikacji z nagłówkami z vercel.json (w tym CSP), a vendor/supabase.js zastępuje atrapą.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const root = path.join(__dirname, '..');
const hdrs = {};
for (const h of JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers) hdrs[h.key] = h.value;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let server, base, browser;
test.before(async () => {
  server = http.createServer((q, r) => {
    const u = q.url.split('?')[0];
    const f = u === '/vendor/supabase.js' ? path.join(__dirname, 'stub-supabase.js') : path.join(root, u === '/' ? 'index.html' : u);
    if (!f.startsWith(__dirname) && !f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, Object.assign({ 'Content-Type': types[path.extname(f)] || 'text/plain' }, hdrs));
    r.end(fs.readFileSync(f));
  });
  await new Promise(res => server.listen(0, res));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); });

const ADMIN = { user: { id: 'o1', email: 'wlasciciel@example.com', user_metadata: {} } };
const DEBTOR = {
  user: { id: 'u2', email: 'zosia@dluznik.invalid', user_metadata: { role: 'debtor' } },
  me: { debtor_id: 'd1', name: 'Zosia', login: 'zosia', entries: [{ id: 'e1', type: 'loan', date: '2026-10-01', amount: 500, note: 'Syfon' }], requests: [] },
};

async function open(cfg, ctxOpts = {}, init) {
  const ctx = await browser.newContext(ctxOpts);
  ctx.setDefaultTimeout(8000);
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await ctx.addInitScript(c => {
    window.__cfg = c; window.__viol = [];
    document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + e.blockedURI));
  }, cfg);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.goto(base);
  return { page, ctx };
}
const text = async p => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
// Dłużnik zgłasza spłatę "za plecami" aplikacji, a potem karta wraca na pierwszy plan (zdarzenie visibilitychange).
const newRequestAndReturn = page => page.evaluate(() => {
  window.__db.repayment_requests.push({ id: 'r1', debtor_id: 'd1', owner_id: 'o1', amount: 200, method: 'blik', note: 'x', status: 'pending', created_at: new Date().toISOString() });
  window.S.lastLoad = 0;
  document.dispatchEvent(new Event('visibilitychange'));
});

test('właściciel: widok się ładuje, bez naruszeń CSP i błędów JS', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('.total');
  assert.ok((await text(page)).includes('500,00'));
  assert.deepEqual(await page.evaluate(() => window.__viol), []);
  assert.deepEqual(page.errs, []);
  await ctx.close();
});

test('odświeżanie po powrocie do aplikacji: nowe zgłoszenie pojawia się bez przeładowania', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('.total');
  await newRequestAndReturn(page);
  await page.waitForFunction(() => document.body.innerText.includes('Zgłoszone spłaty do akceptacji (1)'));
  await ctx.close();
});

test('odświeżanie nie rusza wpisywanego tekstu', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('.total');
  await page.fill('#qa', '123');
  await newRequestAndReturn(page);
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#qa'), '123');
  assert.ok(!(await text(page)).includes('Zgłoszone spłaty do akceptacji'), 'odświeżenie powinno poczekać, aż skończysz wpisywać');
  await ctx.close();
});

test('usuwanie wpisu pyta o potwierdzenie', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('[data-del]');
  page.once('dialog', d => d.dismiss());
  await page.click('[data-del]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__db.entries.length), 1, 'po odmowie wpis zostaje');
  page.once('dialog', d => { assert.match(d.message(), /Usunąć wpis: pożyczka 500,00/); d.accept(); });
  await page.click('[data-del]');
  await page.waitForFunction(() => window.__db.entries.length === 0);
  await ctx.close();
});

test('import: duplikaty są oznaczone i domyślnie pomijane, a odznaczenie pola je przywraca', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('#imptxt');
  await page.fill('#imptxt', '01.10.2026 +500\n02.10.2026 +100');
  await page.click('#prev');
  await page.waitForSelector('#skipdup');
  let t = await text(page);
  assert.ok(t.includes('Wykryto 1 wpisów, które już są na liście') && t.includes('już jest') && t.includes('Importuj 1 wpisów'), t.slice(0, 300));
  await page.uncheck('#skipdup');
  assert.ok((await text(page)).includes('Importuj 2 wpisów'));
  await page.check('#skipdup');
  page.once('dialog', d => { assert.match(d.message(), /Pominięto 1, które już są na liście/); d.accept(); });
  await page.click('#doImp');
  await page.waitForFunction(() => window.__db.entries.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__db.entries.map(e => e.date).sort()), ['2026-10-01', '2026-10-02']);
  await ctx.close();
});

test('dłużnik: widok z rozliczeniem, PDF i informacją o prywatności', async () => {
  const { page, ctx } = await open(DEBTOR, {}, () => { window.print = () => { window.__printed = (document.getElementById('pdfdoc') || {}).innerText; }; });
  await page.waitForSelector('#dPdf');
  const t = await text(page);
  assert.ok(t.includes('Rozliczenie: Zosia') && t.includes('500,00') && t.includes('Prywatność') && t.includes('Frankfurt'), t.slice(0, 300));
  assert.equal(await page.locator('#addD').count(), 0, 'dłużnik nie widzi funkcji właściciela');
  await page.click('#dPdf');
  const doc = await page.evaluate(() => window.__printed);
  for (const part of ['Rozliczenie pożyczek', 'Zosia', '500,00', 'Dawida Thai Thanh']) assert.ok(doc.includes(part), 'w PDF brakuje: ' + part);
  await ctx.close();
});

test('konto dłużnika z odebranym dostępem jest wylogowywane z komunikatem', async () => {
  const { page, ctx } = await open({ user: DEBTOR.user, me: null });
  await page.waitForSelector('#login');
  assert.ok((await text(page)).includes('Dostęp do tego konta został wyłączony'));
  assert.equal(await page.locator('#addD').count(), 0, 'nie wolno pokazać widoku właściciela');
  await ctx.close();
});

test('PWA: service worker, powłoka w cache i tryb offline po przeładowaniu', async () => {
  const { page, ctx } = await open(ADMIN);
  await page.waitForSelector('.total');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('.total');
  const cached = await page.evaluate(async () => (await (await caches.open('dluznik-v1')).keys()).map(r => new URL(r.url).pathname));
  for (const f of ['/index.html', '/app.js', '/loans.js', '/vendor/supabase.js', '/manifest.webmanifest']) assert.ok(cached.includes(f), 'brak w cache: ' + f);
  await ctx.setOffline(true);
  await page.evaluate(() => localStorage.setItem('__fail', '1'));
  await page.reload();
  await page.waitForSelector('#retry');
  const t = await text(page);
  assert.ok(t.includes('Tryb offline') && t.includes('Zosia') && t.includes('500,00'), t.slice(0, 300));
  await ctx.close();
});

test('instalacja: Android (przycisk) i iPhone (instrukcja, ukrywanie)', async () => {
  const a = await open(ADMIN);
  await a.page.waitForSelector('.total');
  await a.page.evaluate(() => {
    window.__prompted = 0; const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e);
  });
  await a.page.click('#instBtn');
  await a.page.waitForFunction(() => !document.getElementById('instCard'));
  assert.equal(await a.page.evaluate(() => window.__prompted), 1);
  await a.ctx.close();

  const i = await open(ADMIN, { ...devices['iPhone 13'] });
  await i.page.waitForSelector('#instNo');
  assert.ok((await text(i.page)).includes('Dodaj do ekranu początkowego'));
  await i.page.click('#instNo');
  await i.page.reload();
  await i.page.waitForSelector('.total');
  assert.equal(await i.page.locator('#instCard').count(), 0, 'po ukryciu karta nie wraca');
  await i.ctx.close();
});

test('powiadomienia push: włączenie zapisuje subskrypcję, a bez instalacji na iPhone jest wyjaśnienie', async () => {
  const fake = () => {
    const mk = () => { const e = localStorage.getItem('__ep'); return e ? { endpoint: e, toJSON: () => ({ endpoint: e, keys: { p256dh: 'BP' + 'x'.repeat(85), auth: 'a'.repeat(22) } }), unsubscribe: async () => { localStorage.removeItem('__ep'); return true; } } : null; };
    Object.defineProperty(Notification, 'permission', { get: () => localStorage.getItem('__perm') || 'default', configurable: true });
    Notification.requestPermission = async () => { localStorage.setItem('__perm', 'granted'); return 'granted'; };
    PushManager.prototype.getSubscription = async () => mk();
    PushManager.prototype.subscribe = async o => { window.__opts = { len: o.applicationServerKey.length, first: o.applicationServerKey[0], visible: o.userVisibleOnly }; localStorage.setItem('__ep', 'https://fcm.googleapis.com/fcm/send/e2e'); return mk(); };
  };
  const { page, ctx } = await open(ADMIN, {}, fake);
  await page.waitForSelector('#pushOn');
  await page.click('#pushOn');
  await page.waitForSelector('#pushOff');
  assert.deepEqual(await page.evaluate(() => window.__opts), { len: 65, first: 4, visible: true });
  assert.equal(await page.evaluate(() => window.__db.push_subscriptions.length), 1);
  await ctx.close();

  const ios = await open(ADMIN, { ...devices['iPhone 13'] }, () => { delete window.PushManager; });
  await ios.page.waitForSelector('#instNo');
  await ios.page.waitForFunction(() => document.body.innerText.includes('powiadomienia działają po dodaniu aplikacji do ekranu głównego'));
  assert.equal(await ios.page.locator('#pushOn').count(), 0);
  await ios.ctx.close();
});
