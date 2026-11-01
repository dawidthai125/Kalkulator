// Statyczne kontrole, które pilnują zabezpieczeń strony. Uruchomienie: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('index.html nie ma skryptów inline (wymóg CSP script-src self)', () => {
  const inline = read('index.html').match(/<script(?![^>]*\ssrc=)[^>]*>/g);
  assert.equal(inline, null, 'znaleziono <script> bez src: ' + inline);
});

test('index.html nie ładuje skryptów z obcych domen', () => {
  const srcs = [...read('index.html').matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  assert.ok(srcs.length > 0);
  for (const s of srcs) assert.ok(!/^(https?:)?\/\//.test(s), 'obcy skrypt: ' + s);
});

test('nie ma inline obsługi zdarzeń (onclick=...) w index.html ani app.js', () => {
  for (const f of ['index.html', 'app.js']) {
    assert.equal(/\son[a-z]+\s*=\s*["']/i.test(read(f)), false, f);
  }
});

test('vercel.json ustawia CSP i podstawowe nagłówki bezpieczeństwa', () => {
  const h = {};
  for (const x of JSON.parse(read('vercel.json')).headers.flatMap(r => r.headers)) h[x.key] = x.value;
  const csp = h['Content-Security-Policy'];
  assert.ok(csp, 'brak CSP');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), 'script-src nie może mieć unsafe-*');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.ok(h['Referrer-Policy']);
});

test('CSP pozwala łączyć się tylko z projektem Supabase użytym w app.js', () => {
  const url = read('app.js').match(/createClient\('(https:\/\/[^']+)'/)[1];
  const h = JSON.parse(read('vercel.json')).headers[0].headers.find(x => x.key === 'Content-Security-Policy');
  assert.match(h.value, new RegExp("connect-src " + url.replace(/[.]/g, '\\.') + '(;|$)'));
});

test('w kodzie strony nie ma jawnych haseł ani sekretów (klucz publishable jest dozwolony)', () => {
  for (const f of ['index.html', 'app.js', 'loans.js']) {
    const s = read(f);
    assert.ok(!/test12345/.test(s), f + ': jawne hasło tymczasowe');
    assert.ok(!/service_role|sb_secret_/.test(s), f + ': klucz serwisowy');
  }
  assert.match(read('app.js'), /sb_publishable_/); // publiczny klucz, chroni go RLS
});

test('esc() jest używane przy wstawianiu nazw dłużników do HTML', () => {
  const app = read('app.js');
  assert.match(app, /esc\(d\.name/);
  assert.match(app, /esc\(x\.who\)/);
  assert.match(app, /esc\(S\.user\.email\)/);
});
