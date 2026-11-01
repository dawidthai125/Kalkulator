/* Logika liczenia pożyczek i importu z Notatek.
 * Plik działa w przeglądarce (globalny obiekt Loans) i w Node (require), żeby dało się go testować.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Loans = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function today() { return new Date().toISOString().slice(0, 10); }

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
    return { cap: cap, int: int, owed: cap + int - over, lent: lent, paid: paid, sorted: ev };
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
  function parseNotes(txt, flip, who, asOf) {
    var out = [], skip = [];
    txt.split(/\r?\n/).forEach(function (l) {
      var s = l.trim(); if (!s) return;
      var dm = s.match(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/), date = asOf || today();
      if (dm) {
        if (dm[1]) date = dm[0];
        else {
          var y = dm[6].length === 2 ? '20' + dm[6] : dm[6];
          date = y + '-' + ('0' + dm[5]).slice(-2) + '-' + ('0' + dm[4]).slice(-2);
        }
        s = s.replace(dm[0], ' ');
      }
      var am = s.match(/([+\-−–])?\s*(\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
      if (!am) {
        var h = s.replace(/[:\-–]+$/, '').trim();
        if (h && !/\d/.test(h)) who = h; else skip.push(l.trim());
        return;
      }
      var raw = am[2],
        num = (/[  ]/.test(raw) || /\.\d{3}/.test(raw)) ? raw.replace(/[  .]/g, '').replace(',', '.') : raw.replace(',', '.');
      var v = parseFloat(num); if (!(v > 0)) { skip.push(l.trim()); return; }
      var neg = !!am[1] && am[1] !== '+'; if (flip) neg = !neg;
      out.push({ who: who, date: date, type: neg ? 'pay' : 'loan', amount: Math.round(v * 100) / 100 });
    });
    return { rows: out, skip: skip };
  }

  return { today: today, esc: esc, days: days, calc: calc, monthlyPayment: monthlyPayment, parseNotes: parseNotes };
});
