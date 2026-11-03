/* Logika liczenia pożyczek i importu z Notatek.
 * Plik działa w przeglądarce (globalny obiekt Loans) i w Node (require), żeby dało się go testować.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Loans = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Dzień według czasu lokalnego (toISOString dałoby UTC: po północy w Polsce wczorajszą datę).
  function localDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function today() { return localDate(new Date()); }

  // Zaokrąglenie do groszy; "+ 0" zamienia -0 na 0.
  function money(x) { return Math.round(x * 100) / 100 + 0; }

  // Czy 'RRRR-MM-DD' to istniejąca data kalendarzowa (np. nie 2026-02-30).
  function validDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function days(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

  // d = { rate: % rocznie, entries: [{ type: 'loan'|'pay', date: 'RRRR-MM-DD', amount }] }
  // asOf = data, na którą liczymy odsetki (domyślnie dziś).
  // Odsetki proste (365 dni), spłata pokrywa najpierw odsetki, potem kapitał.
  function calc(d, asOf) {
    var ev = d.entries.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.type === 'loan' ? -1 : 1);
    });
    var cap = 0, int = 0, last = null, lent = 0, paid = 0, over = 0, r = (+d.rate || 0) / 100 / 365;
    ev.forEach(function (e) {
      if (last && cap > 0) int += cap * r * Math.max(0, days(last, e.date));
      last = e.date;
      if (e.type === 'loan') { cap += e.amount; lent += e.amount; }
      else {
        paid += e.amount;
        var p = e.amount, t = Math.min(p, int);
        int -= t; p -= t;
        var c = Math.min(p, cap);
        cap -= c; over += p - c;
      }
    });
    if (last && cap > 0) int += cap * r * Math.max(0, days(last, asOf || today()));
    // Zaokrąglamy dopiero na końcu (w trakcie liczymy na pełnej precyzji).
    return { cap: money(cap), int: money(int), owed: money(cap + int - over), lent: money(lent), paid: money(paid), sorted: ev };
  }

  // Rata miesięczna (annuitetowa) dla kwoty P, rocznej stopy rate (%) i n miesięcy.
  function monthlyPayment(P, rate, n) {
    n = Math.max(1, n || 1);
    var i = (+rate || 0) / 100 / 12;
    if (!(P > 0)) return 0;
    return i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
  }

  // Zwraca { rows: [{ who, date, type, amount }], skip: [linie bez kwoty] }.
  // who = domyślny dłużnik; linia bez kwoty i bez cyfr zmienia dłużnika dla kolejnych wpisów.
  var LET = 'A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż';
  var CUR_SRC = '(?:z[łl]|pln)(?![' + LET + '])';
  var NUM_SRC = '\\d{1,3}(?:[ \\u00a0.]\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
  var AMOUNT_SRC = '(^|[^' + LET + '\\d])([+\\-\\u2212\\u2013])?(' + NUM_SRC + ')(?!\\d)(\\s*' + CUR_SRC + ')?(\\s*h(?![' + LET + ']))?';
  var SUMMARY_START = new RegExp('^(razem|suma|sumy|całość|calosc|do zapłaty|do zaplaty|zostało|zostalo|było|bylo|jest|poprzednio)(?![' + LET + '])', 'i');
  var PAY_HEADER = /(faktur\w*\s+wp[łl]at|wp[łl]at\w*\s+faktur|przelew\w*\s+otrzyman|wp[łl]yw\w*\s+na\s+konto|zwrot\w*)/i;

  function toNumber(raw) {
    var num = (/[  ]/.test(raw) || /\.\d{3}/.test(raw)) ? raw.replace(/[  .]/g, '').replace(',', '.') : raw.replace(',', '.');
    return parseFloat(num);
  }

  // Data bez roku ("27.05") dostaje rok z asOf; jeśli wychodzi w przyszłości, to rok wcześniejszy.
  function shortDate(dd, mm, asOf) {
    var y = +asOf.slice(0, 4), iso = y + '-' + pad2(+mm) + '-' + pad2(+dd);
    if (!validDate(iso)) return null;
    if (iso > asOf) { y -= 1; iso = y + '-' + pad2(+mm) + '-' + pad2(+dd); if (!validDate(iso)) return null; }
    return iso;
  }

  // Stawka godzinowa z mnożeń typu "45h x 40 = 1800": najczęstszy mnożnik w notatce.
  function detectRate(txt) {
    var re = /x\s*(\d{2,3})\s*=/gi, cnt = {}, best = 0, m;
    txt = txt.replace(/[\u200b-\u200f\u2060\ufeff\ufffc]/g, '');
    while ((m = re.exec(txt)) !== null) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
    Object.keys(cnt).forEach(function (k) { if (!best || cnt[k] > cnt[best]) best = k; });
    return +best || 0;
  }

  function cleanNote(txt) {
    var n = txt.replace(/\(\s*(?:r\.?)?\s*\)/g, ' ').replace(/(^|\s)r\.(?=\s|$)/g, ' ')
      .replace(new RegExp('(^|[^' + LET + '])' + CUR_SRC, 'gi'), '$1')
      .replace(/^[\s:;,.\-–−()]+|[\s:;,\-–−(]+$/g, '')
      .replace(/\s+/g, ' ').trim();
    return n.length > 200 ? n.slice(0, 200).trim() : n;
  }

  // Rozumie notatki w stylu: "1500 zł klej", "-200 zł", sekcje "Faktury wpłaty:" (spłaty), pomija sumy i obliczenia.
  //  - kwota ze znakiem "-" lub w sekcji spłat = spłata, w pozostałych przypadkach pożyczka (dług)
  //  - opts.headersAsDebtors: linia bez kwoty (np. "Jan Kowalski:") zmienia dłużnika (domyślnie włączone, jak dawniej)
  // Zwraca { rows: [{ who, date, type, amount, note? }], skip: [linie pominięte] }
  function parseNotes(txt, flip, who, asOf, opts) {
    asOf = asOf || today();
    var headersAsDebtors = !(opts && opts.headersAsDebtors === false);
    var defDate = (opts && opts.defaultDate && validDate(opts.defaultDate)) ? opts.defaultDate : asOf;
    var out = [], skip = [], mode = null, amountRe, hoursLines = 0;
    var rate = opts && +opts.hourlyRate > 0 ? +opts.hourlyRate : detectRate(txt);
    txt.split(/\r?\n/).forEach(function (l) {
      var orig = l.trim();
      var s = l.replace(/[​-‏⁠﻿￼]/g, '').trim();
      if (!s) { mode = null; return; }

      // Data: pełna (dd.mm.rrrr, rrrr-mm-dd) albo bez roku (dd.mm)
      var date = defDate, dm = s.match(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/);
      if (dm) {
        if (dm[1]) date = dm[0];
        else date = (dm[6].length === 2 ? '20' + dm[6] : dm[6]) + '-' + pad2(+dm[5]) + '-' + pad2(+dm[4]);
        if (!validDate(date)) { skip.push(orig); return; }
        s = s.slice(0, dm.index) + ' '.repeat(dm[0].length) + s.slice(dm.index + dm[0].length);
      } else {
        var sm = new RegExp('(^|[^\\d.,])(\\d{1,2})\\.(\\d{1,2})(?![\\d.,]|\\s*' + CUR_SRC + ')', 'i').exec(s);
        var sd = sm && shortDate(sm[2], sm[3], asOf);
        if (sd) {
          date = sd;
          var at = sm.index + sm[1].length, len = sm[0].length - sm[1].length;
          s = s.slice(0, at) + ' '.repeat(len) + s.slice(at + len);
        }
      }

      // Do wykrywania kwot kody typu "PIT-28" nie są liczbami
      var scan = s.replace(/[A-Za-z]+-\d+/g, function (m) { return ' '.repeat(m.length); });
      var exportLike = /^\s*\d{2}\.\d{2}\.\d{4}\s+[+\-−–]\d/.test(orig);

      var amount = null, neg = false, note = '';

      // Mnożenie "45h x 40 = 1800 zł": liczy się wynik
      var mult = /(?:\d\s*h?|\s)x\s*\d+/i.test(scan) && !/\+/.test(scan) && (scan.match(/=/g) || []).length === 1 &&
        new RegExp('=\\s*(' + NUM_SRC + ')\\s*(?:' + CUR_SRC + ')?\\s*$', 'i').exec(scan);
      if (mult && !exportLike) {
        amount = toNumber(mult[1]);
        note = cleanNote(s.slice(0, scan.indexOf('=')));
      } else {
        if (!exportLike && (/=/.test(scan) || new RegExp('\\d\\s*(?:' + CUR_SRC + ')?\\s*h?\\s*\\+\\s*\\(?\\s*\\d', 'i').test(scan))) {
          skip.push(orig); return;   // suma lub obliczenie
        }
        amountRe = new RegExp(AMOUNT_SRC, 'gi');
        var cands = [], hrsList = [], m;
        while ((m = amountRe.exec(scan)) !== null) {
          var start = m.index + m[1].length, end = m.index + m[0].length;
          var v = toNumber(m[3]);
          if (v > 0 && m[5]) { hrsList.push(v); continue; }   // godziny (45h)
          if (!(v > 0) || /^\/\d/.test(scan.slice(end))) continue;   // ułamki "20/2", zera
          cands.push({ sign: m[2] || '', v: v, cur: !!m[4], start: start, end: end });
        }
        var pick = cands.filter(function (c) { return c.sign; })[0] ||
          cands.filter(function (c) { return c.cur; })[0];
        if (!pick) {
          var bare = cands.filter(function (c) { return c.v >= 10; });
          if (cands.length === 1 && bare.length === 1) pick = bare[0];
        }
        var head = s.replace(/[:\-–]+$/, '').trim();
        var godz = /^godzin/i.test(head), hoursVal = 0;
        if (!pick && !cands.length && hrsList.length === 1) hoursVal = hrsList[0];
        else if (godz && pick && !pick.cur && !pick.sign) { hoursVal = pick.v; pick = null; }
        if (hoursVal) {   // same godziny: kwota = godziny × stawka
          if (mode === 'skip' || !(rate > 0)) { skip.push(orig); return; }
          var hneg = mode === 'pay'; if (flip) hneg = !hneg;
          var hrow = { who: who, date: date, type: hneg ? 'pay' : 'loan', amount: Math.round(hoursVal * rate * 100) / 100 };
          var hn = cleanNote(s); hrow.note = (hn ? hn + ' ' : '') + '(× ' + rate + ' zł/h)';
          out.push(hrow); hoursLines++;
          return;
        }

        if (!pick) {
          if (cands.length || /\d/.test(head)) { skip.push(orig); return; }   // liczba, ale nie wiadomo która
          if (!head) { skip.push(orig); return; }
          // Linia bez cyfr: nagłówek sekcji albo dłużnik
          if (SUMMARY_START.test(head) || godz) mode = 'skip';
          else if (PAY_HEADER.test(head)) mode = 'pay';
          else { mode = null; if (headersAsDebtors) who = head; }
          return;
        }
        if (SUMMARY_START.test(head) || mode === 'skip') { skip.push(orig); return; }
        amount = pick.v;
        neg = !!pick.sign && pick.sign !== '+';
        if (mode === 'pay' && pick.sign !== '+') neg = true;
        note = cleanNote(s.slice(0, pick.start) + ' ' + s.slice(pick.end));
        if (/^(koszty|razem|suma|łącznie|całość|total)$/i.test(note)) { skip.push(orig); return; }
        if (flip) neg = !neg;
        var row = { who: who, date: date, type: neg ? 'pay' : 'loan', amount: Math.round(amount * 100) / 100 };
        if (note) row.note = note;
        out.push(row);
        return;
      }
      // gałąź mnożenia
      if (!(amount > 0)) { skip.push(orig); return; }
      if (flip) neg = !neg;
      var r2 = { who: who, date: date, type: neg ? 'pay' : 'loan', amount: Math.round(amount * 100) / 100 };
      if (note) r2.note = note;
      out.push(r2);
    });
    return { rows: out, skip: skip, hours: { rate: rate, lines: hoursLines } };
  }

  // Co zrobić ze zdarzeniem logowania z Supabase. Supabase wysyła SIGNED_IN także przy każdym powrocie
  // do karty i odświeżeniu tokenu; wtedy NIE wolno przeładowywać widoku, bo kasuje to wpisywaną kwotę.
  // prev/next = użytkownik { id } albo null. Zwraca 'same' | 'login' | 'logout'.
  function authTransition(prev, next) {
    if (!next) return 'logout';
    return prev && prev.id === next.id ? 'same' : 'login';
  }

  // Zostawia w tekście tylko kwotę: cyfry i jeden separator dziesiętny (przecinek lub kropka), najwyżej
  // 2 miejsca po nim. Litery, spacje i minus są usuwane ("148 Syfon" -> "148").
  function numOnly(v) {
    var m = String(v).replace(/[^\d.,]/g, '').match(/^\d*[.,]?\d{0,2}/);
    return m ? m[0] : '';
  }

  // 'RRRR-MM-DD' -> 'DD.MM.RRRR'; coś innego zostaje bez zmian.
  function datePL(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : (iso || '');
  }

  // Dane do dokumentu rozliczenia dla dłużnika: długi i spłaty osobno (po dacie), sumy i kwota końcowa.
  // due = kwota bezwzględna; status: 'debt' (do spłaty), 'settled' (rozliczone), 'over' (nadpłata).
  function settlement(d, asOf) {
    var c = calc(d, asOf);
    function rows(type) {
      return c.sorted.filter(function (e) { return e.type === type; })
        .map(function (e) { return { date: e.date, note: e.note || '', amount: e.amount }; });
    }
    return {
      loans: rows('loan'), pays: rows('pay'), lent: c.lent, paid: c.paid, due: money(Math.abs(c.owed)),
      status: c.owed > 0 ? 'debt' : c.owed < 0 ? 'over' : 'settled'
    };
  }

  // Login dłużnika bez @ to nazwa nadana przez właściciela; do logowania zamieniamy go na techniczny adres
  // (zarezerwowana domena .invalid, poczta tam nie dociera). Tekst z @ traktujemy jak zwykły e-mail właściciela.
  function loginToEmail(v) {
    v = String(v || '').trim().toLowerCase();
    return !v ? '' : (v.indexOf('@') >= 0 ? v : v + '@dluznik.invalid');
  }

  // Ta sama reguła co w bazie (debtor_access.login) i w funkcji serwerowej.
  function validLogin(v) { return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(String(v || '')); }

  function methodLabel(m) {
    return { blik: 'BLIK', przelew: 'Przelew', gotowka: 'Gotówka', inne: 'Inna forma' }[m] || 'Inna forma';
  }

  function statusLabel(s) {
    return { pending: 'Czeka na akceptację', approved: 'Zaakceptowana', rejected: 'Odrzucona' }[s] || s;
  }

  // Czy błąd to brak połączenia z internetem (komunikaty Chrome, Firefox i Safari), a nie błąd logiczny (hasło, uprawnienia).
  function isNetworkError(err) {
    var m = String(err && err.message ? err.message : (err || ''));
    return /failed to fetch|networkerror|load failed|network request failed|internet connection appears to be offline|network connection was lost|fetch failed/i.test(m);
  }

  // Klucz VAPID (base64url, bez dopełnienia) na bajty, jak wymaga PushManager.subscribe({ applicationServerKey }).
  function urlBase64ToUint8Array(s) {
    var b = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b), o = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i);
    return o;
  }

  // Oznacza wiersze importu, które już są na liście (ta sama data, rodzaj i kwota). Liczy krotność: jeśli na liście
  // jest jeden taki wpis, a import ma dwa, to tylko jeden jest duplikatem. existingFor(who) zwraca istniejące wpisy
  // dłużnika o tej nazwie. Zwraca nowe obiekty z polem dup, wejścia nie zmienia.
  function markDuplicates(rows, existingFor) {
    var left = {};
    function key(e) { return e.date + '|' + e.type + '|' + (Math.round(e.amount * 100) / 100).toFixed(2); }
    return rows.map(function (r) {
      var who = String(r.who || '').toLowerCase();
      if (!left[who]) { left[who] = {}; (existingFor(r.who) || []).forEach(function (e) { left[who][key(e)] = (left[who][key(e)] || 0) + 1; }); }
      var k = key(r), dup = (left[who][k] || 0) > 0;
      if (dup) left[who][k]--;
      return Object.assign({}, r, { dup: dup });
    });
  }

  // Czy teraz odświeżyć dane po cichu: karta widoczna, ktoś zalogowany, nic się nie ładuje, nikt nic nie wpisuje
  // i minęło co najmniej minMs od poprzedniego wczytania.
  function shouldRefresh(o) {
    return !o.hidden && !!o.loggedIn && !o.busy && !o.typing && (o.now - o.last) >= o.minMs;
  }

  // Opis wiersza dziennika zmian (tabela entry_log): { label, text } po polsku.
  function describeLog(row) {
    function money(v) { return (Math.round(Number(v) * 100) / 100).toFixed(2).replace('.', ','); }
    function kind(t) { return t === 'loan' ? 'pożyczka' : t === 'pay' ? 'spłata' : String(t || ''); }
    function quoted(s) { return s ? '„' + s + '”' : '—'; }
    function line(e) { return e ? kind(e.type) + ' ' + money(e.amount) + ' zł z ' + datePL(e.date) + (e.note ? ' (' + e.note + ')' : '') : ''; }
    if (row.action === 'insert') return { label: 'Dodano', text: line(row.new_data) };
    if (row.action === 'delete') return { label: 'Usunięto', text: line(row.old_data) };
    if (row.action === 'update') {
      var o = row.old_data, n = row.new_data, parts = [];
      if (!o || !n) return { label: 'Zmieniono', text: 'bez zmian w polach wpisu' };
      if (o.type !== n.type) parts.push('rodzaj ' + kind(o.type) + ' → ' + kind(n.type));
      if (o.date !== n.date) parts.push('data ' + datePL(o.date) + ' → ' + datePL(n.date));
      if (Number(o.amount) !== Number(n.amount)) parts.push('kwota ' + money(o.amount) + ' → ' + money(n.amount) + ' zł');
      if ((o.note || '') !== (n.note || '')) parts.push('opis ' + quoted(o.note) + ' → ' + quoted(n.note));
      return { label: 'Zmieniono', text: parts.join('; ') || 'bez zmian w polach wpisu' };
    }
    return { label: String(row.action), text: '' };
  }

  // --- Kopia zapasowa ---
  // Kopia to zwykły JSON: dłużnicy i ich wpisy. Bez haseł, loginów dłużników, identyfikatorów i próśb o spłatę.
  function buildBackup(debtors, now) {
    return {
      app: 'dluznik-2.0', version: 1, exported_at: (now || new Date()).toISOString(),
      debtors: debtors.map(function (d) {
        return {
          name: d.name, remind_at: d.remind_at || '', remind_note: d.remind_note || '',
          entries: d.entries.map(function (e) { return { type: e.type, date: e.date, amount: e.amount, note: e.note || '' }; })
        };
      })
    };
  }

  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }

  // Wczytuje i sprawdza plik kopii. Każdy błąd odrzuca cały plik, żeby nie wgrać połowy danych.
  function parseBackup(text) {
    var b;
    function no(msg) { return { ok: false, error: msg }; }
    try { b = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { return no('To nie jest poprawny plik JSON.'); }
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.app !== 'dluznik-2.0') return no('Ten plik nie jest kopią zapasową z tej aplikacji.');
    if (b.version !== 1) return no('Nieobsługiwana wersja kopii.');
    if (!Array.isArray(b.debtors) || b.debtors.length > 500) return no('Nieprawidłowa lista dłużników (max 500).');
    var total = 0, out = [];
    for (var i = 0; i < b.debtors.length; i++) {
      var d = b.debtors[i], at = 'Dłużnik ' + (i + 1) + ': ';
      if (!d || typeof d !== 'object') return no(at + 'nieprawidłowe dane.');
      var name = typeof d.name === 'string' ? d.name.trim() : '';
      if (!name || name.length > 100) return no(at + 'nazwa musi mieć od 1 do 100 znaków.');
      if (!Array.isArray(d.entries)) return no(at + 'brak listy wpisów.');
      var ra = d.remind_at == null || d.remind_at === '' ? '' : d.remind_at;
      if (ra !== '' && !validDate(ra)) return no(at + 'nieprawidłowa data przypomnienia.');
      var rn = d.remind_note == null ? '' : d.remind_note;
      if (typeof rn !== 'string' || rn.length > 200) return no(at + 'nieprawidłowy opis przypomnienia.');
      var ents = [];
      for (var j = 0; j < d.entries.length; j++) {
        var e = d.entries[j], w = at + 'wpis ' + (j + 1) + ': ';
        if (++total > 50000) return no('Za dużo wpisów (max 50 000).');
        if (!e || typeof e !== 'object') return no(w + 'nieprawidłowe dane.');
        if (e.type !== 'loan' && e.type !== 'pay') return no(w + 'nieznany rodzaj.');
        if (!validDate(e.date)) return no(w + 'nieprawidłowa data.');
        if (typeof e.amount !== 'number' || !isFinite(e.amount) || Math.round(e.amount * 100) < 1 || e.amount > 1e9) return no(w + 'kwota musi być liczbą większą od zera.');
        var note = e.note == null ? '' : e.note;
        if (typeof note !== 'string' || note.length > 200) return no(w + 'opis może mieć najwyżej 200 znaków.');
        ents.push({ type: e.type, date: e.date, amount: Math.round(e.amount * 100) / 100, note: note });
      }
      out.push({ name: name, remind_at: ra, remind_note: rn, entries: ents });
    }
    return { ok: true, data: { app: b.app, version: 1, exported_at: b.exported_at || '', debtors: out }, counts: { debtors: out.length, entries: total } };
  }

  // CSV pod Excela: BOM, średniki, przecinek dziesiętny. Komórki zaczynające się od = + - @ dostają apostrof (formuły).
  function backupCsv(backup) {
    function cell(v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[;"\r\n]/.test(v) || v.charAt(0) === "'" ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var lines = ['Dłużnik;Data;Rodzaj;Kwota;Opis'];
    backup.debtors.forEach(function (d) {
      d.entries.forEach(function (e) {
        lines.push([cell(d.name), e.date, e.type === 'loan' ? 'Pożyczka' : 'Spłata', (Math.round(e.amount * 100) / 100).toFixed(2).replace('.', ','), cell(e.note)].join(';'));
      });
    });
    return '﻿' + lines.join('\r\n');
  }

  // Plan wczytania kopii: tylko dodawanie. Istniejących dłużników rozpoznaje po nazwie, wpisy już obecne pomija.
  function planRestore(data, existing) {
    var byName = {};
    existing.forEach(function (d) { byName[d.name.toLowerCase()] = d; });
    var rows = [];
    data.debtors.forEach(function (d, i) { d.entries.forEach(function (e) { rows.push({ who: d.name, i: i, type: e.type, date: e.date, amount: e.amount, note: e.note }); }); });
    var marked = markDuplicates(rows, function (who) { var k = byName[String(who).toLowerCase()]; return k ? k.entries : []; });
    var items = data.debtors.map(function (d, i) {
      var k = byName[d.name.toLowerCase()];
      return {
        name: d.name, exists: k ? k.id : null, remind_at: d.remind_at, remind_note: d.remind_note,
        entries: marked.filter(function (m) { return m.i === i && !m.dup; }).map(function (m) { return { type: m.type, date: m.date, amount: m.amount, note: m.note }; })
      };
    });
    return {
      items: items,
      newDebtors: items.filter(function (x) { return !x.exists; }).length,
      newEntries: items.reduce(function (a, x) { return a + x.entries.length; }, 0),
      skipped: marked.filter(function (m) { return m.dup; }).length
    };
  }

  return { buildBackup: buildBackup, parseBackup: parseBackup, backupCsv: backupCsv, planRestore: planRestore, describeLog: describeLog, markDuplicates: markDuplicates, shouldRefresh: shouldRefresh, urlBase64ToUint8Array: urlBase64ToUint8Array, isNetworkError: isNetworkError, today: today, localDate: localDate, esc: esc, days: days, calc: calc, monthlyPayment: monthlyPayment, parseNotes: parseNotes, authTransition: authTransition, numOnly: numOnly, datePL: datePL, settlement: settlement, loginToEmail: loginToEmail, validLogin: validLogin, methodLabel: methodLabel, statusLabel: statusLabel };
});
