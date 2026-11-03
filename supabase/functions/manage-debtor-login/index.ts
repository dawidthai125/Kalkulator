// Zakładanie, zmiana hasła i usuwanie konta logowania dłużnika. Wywołuje ją tylko właściciel listy.
// Wymaga ważnego JWT właściciela (verify_jwt = true) i dodatkowo sprawdza, że dłużnik należy do wywołującego.
// Klucz serwisowy pochodzi ze zmiennych środowiska funkcji i nigdy nie trafia do przeglądarki.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
// Zarezerwowana domena .invalid: poczta na ten adres nigdy nie zostanie dostarczona,
// więc nikt nie może przejąć konta przez "przypomnij hasło".
const DOMAIN = 'dluznik.invalid';
const META = { must_change_password: true, role: 'debtor' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Metoda niedozwolona.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return json({ error: 'Brak autoryzacji.' }, 401);
  const caller = u.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Błędne dane.' }, 400); }
  const action = String(body.action ?? '');
  const debtorId = String(body.debtor_id ?? '');

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Dłużnik musi należeć do wywołującego (konto dłużnika samo nie przejdzie tego sprawdzenia).
  const { data: debtor } = await admin.from('debtors').select('id,user_id').eq('id', debtorId).maybeSingle();
  if (!debtor || debtor.user_id !== caller) return json({ error: 'Nie znaleziono dłużnika.' }, 404);

  const { data: acc } = await admin.from('debtor_access').select('user_id,login').eq('debtor_id', debtorId).maybeSingle();

  if (action === 'create') {
    const login = String(body.login ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!LOGIN_RE.test(login)) return json({ error: 'Login: 3 do 30 znaków, małe litery bez polskich znaków, cyfry, kropka, myślnik lub podkreślenie.' }, 400);
    if (password.length < 8 || password.length > 72) return json({ error: 'Hasło musi mieć od 8 do 72 znaków.' }, 400);
    if (acc) return json({ error: 'Ten dłużnik ma już dostęp.' }, 409);

    const email = `${login}@${DOMAIN}`;
    // Jednorazowe zezwolenie dla wyzwalacza rejestracji (ważne 10 minut, zużywane przy założeniu konta).
    await admin.from('allowed_signups').upsert({ email, created_at: new Date().toISOString() });
    const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: META });
    if (ce || !cu?.user) {
      await admin.from('allowed_signups').delete().eq('email', email);
      const taken = /already|registered|exists|duplicate/i.test(ce?.message ?? '');
      return json({ error: taken ? 'Taki login jest już zajęty.' : 'Nie udało się założyć konta.' }, taken ? 409 : 500);
    }
    const { error: ie } = await admin.from('debtor_access').insert({ user_id: cu.user.id, debtor_id: debtorId, owner_id: caller, login });
    if (ie) {
      await admin.auth.admin.deleteUser(cu.user.id);
      const taken = /duplicate|unique/i.test(ie.message);
      return json({ error: taken ? 'Taki login jest już zajęty.' : 'Nie udało się zapisać dostępu.' }, taken ? 409 : 500);
    }
    return json({ ok: true, login });
  }

  if (action === 'reset') {
    if (!acc) return json({ error: 'Ten dłużnik nie ma dostępu.' }, 404);
    const password = String(body.password ?? '');
    if (password.length < 8 || password.length > 72) return json({ error: 'Hasło musi mieć od 8 do 72 znaków.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(acc.user_id, { password, user_metadata: META });
    if (error) return json({ error: 'Nie udało się zmienić hasła.' }, 500);
    return json({ ok: true, login: acc.login });
  }

  if (action === 'delete') {
    if (!acc) return json({ error: 'Ten dłużnik nie ma dostępu.' }, 404);
    const { error } = await admin.auth.admin.deleteUser(acc.user_id); // usuwa też wiersz debtor_access (kaskada)
    if (error) return json({ error: 'Nie udało się usunąć dostępu.' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Nieznana akcja.' }, 400);
});
