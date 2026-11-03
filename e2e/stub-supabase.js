// Atrapa biblioteki Supabase do testów przeglądarki (serwer testowy podaje ją zamiast vendor/supabase.js).
// Cała "baza" siedzi w pamięci strony (window.__db), a konfigurację (użytkownik, przegląd dłużnika) podaje test w window.__cfg.
(function () {
  var cfg = window.__cfg || {};
  var DB = window.__db = {
    debtors: [{ id: 'd1', name: 'Zosia', rate: 0, remind_at: null, remind_note: null, created_at: '1' }],
    entries: [{ id: 'e1', debtor_id: 'd1', type: 'loan', date: '2026-10-01', amount: 500, note: 'Syfon' }],
    repayment_requests: [], debtor_access: [], push_subscriptions: [],
  };
  var NET = { message: 'TypeError: Failed to fetch' }, n = 0, cbs = [];
  function failing() { return localStorage.getItem('__fail') === '1'; }
  function q(t) {
    var o = { act: 'select', f: [] };
    o.select = function () { return o; }; o.order = function () { return o; };
    o.eq = function (k, v) { o.f.push([k, v]); return o; };
    o.single = function () { o.s = 1; return o; };
    o.insert = function (r) { o.act = 'insert'; o.r = r; return o; };
    o.delete = function () { o.act = 'delete'; return o; };
    o.update = function (r) { o.act = 'update'; o.r = r; return o; };
    o.then = function (res) {
      if (failing()) return res({ data: null, error: NET });
      var rows = DB[t].filter(function (x) { return o.f.every(function (p) { return x[p[0]] === p[1]; }); });
      if (o.act === 'insert') {
        var made = [].concat(o.r).map(function (r) { var x = Object.assign({ id: 'n' + (++n) }, r); DB[t].push(x); return x; });
        return res({ data: o.s ? made[0] : null, error: null });
      }
      if (o.act === 'delete') { DB[t] = DB[t].filter(function (x) { return rows.indexOf(x) < 0; }); return res({ data: null, error: null }); }
      if (o.act === 'update') { rows.forEach(function (x) { Object.assign(x, o.r); }); return res({ data: null, error: null }); }
      return res({ data: o.s ? (rows[0] || null) : rows.map(function (x) { return Object.assign({}, x); }), error: null });
    };
    return o;
  }
  var RPC = {
    debtor_overview: function () { return cfg.me || null; },
    submit_repayment: function (a) { var id = 'r' + (++n); DB.repayment_requests.push({ id: id, debtor_id: 'd1', owner_id: 'o1', amount: a.p_amount, method: a.p_method, note: a.p_note, status: 'pending', created_at: new Date().toISOString() }); return id; },
    decide_repayment: function (a) {
      var r = DB.repayment_requests.find(function (x) { return x.id === a.p_id; }); if (!r) return null;
      r.status = a.p_approve ? 'approved' : 'rejected';
      if (a.p_approve) DB.entries.push({ id: 'n' + (++n), debtor_id: r.debtor_id, type: 'pay', date: '2026-11-03', amount: r.amount, note: 'Zgłoszone przez dłużnika' });
      return null;
    },
    save_push_subscription: function (a) { DB.push_subscriptions.push({ endpoint: a.p_endpoint }); return null; },
  };
  window.supabase = {
    createClient: function () {
      return {
        from: q,
        rpc: function (name, args) { return Promise.resolve(failing() ? { data: null, error: NET } : { data: (RPC[name] || function () { return null; })(args || {}), error: null }); },
        functions: { invoke: function () { return Promise.resolve({ data: { ok: true, publicKey: 'BJJ7Y9ZK7JOzncnT_9TEijdetZ9B0q0fV1vIsa4rzaUtbHsEyqyCPYc7BtHAKi_h91nFvV7WVQqVArXVpC2ybvs' }, error: null }); } },
        auth: {
          onAuthStateChange: function (cb) {
            cbs.push(cb);
            setTimeout(function () {
              if (cfg.user && localStorage.getItem('__out') !== '1') cb('SIGNED_IN', { user: cfg.user }); else cb('INITIAL_SESSION', null);
            }, 0);
          },
          signOut: function () { localStorage.setItem('__out', '1'); cbs.forEach(function (c) { c('SIGNED_OUT', null); }); return Promise.resolve({}); },
          updateUser: function () { return Promise.resolve({ data: { user: cfg.user }, error: null }); },
          signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
        },
      };
    },
  };
})();
