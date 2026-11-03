// Powiadomienia push: zgłoszenie spłaty -> właściciel listy, decyzja właściciela -> dłużnik.
// Wywoływana przez zalogowanego użytkownika (verify_jwt = true) i niezależnie sprawdzająca, że ma prawo do zdarzenia:
//  * "request": wywołujący jest autorem zgłoszenia (requested_by), zgłoszenie jest świeże (do 10 min),
//  * "decision": wywołujący jest właścicielem zgłoszenia, które zostało rozpatrzone (do 10 min temu).
// Znacznik notified_at / decision_notified_at jest ustawiany atomowo, więc jedno zdarzenie daje najwyżej jedno powiadomienie.
// Klucze VAPID generuje ta funkcja przy pierwszym użyciu i trzyma w push_config (dostęp tylko rola serwisowa).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://kalkulator.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRESH_MS = 10 * 60 * 1000;

const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// deno-lint-ignore no-explicit-any
async function vapidKeys(admin: any): Promise<{ public_key: string; private_key: string }> {
  const read = async () => (await admin.from('push_config').select('public_key,private_key').eq('id', 1).maybeSingle()).data;
  const have = await read();
  if (have) return have;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  // ignoreDuplicates: przy równoległych wywołaniach wygrywa pierwsza para kluczy
  await admin.from('push_config').upsert({ id: 1, public_key: pub, private_key: jwk.d }, { onConflict: 'id', ignoreDuplicates: true });
  return (await read())!;
}

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

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const keys = await vapidKeys(admin);
  if (action === 'key') return json({ publicKey: keys.public_key });
  if (action !== 'notify') return json({ error: 'Nieznana akcja.' }, 400);

  const type = String(body.type ?? '');
  const id = String(body.request_id ?? '');
  if (!UUID.test(id)) return json({ error: 'Błędny identyfikator zgłoszenia.' }, 400);
  const now = new Date().toISOString();
  const since = new Date(Date.now() - FRESH_MS).toISOString();

  let target: string;
  let payload: { title: string; body: string; tag: string; url: string };

  if (type === 'request') {
    const { data: r } = await admin.from('repayment_requests').update({ notified_at: now })
      .eq('id', id).eq('requested_by', caller).is('notified_at', null).gt('created_at', since)
      .select('owner_id').maybeSingle();
    if (!r) return json({ ok: true, sent: 0, reason: 'pominięto' });
    target = r.owner_id;
    // Treść ogólna: powiadomienie widać na ekranie blokady, więc bez imienia i kwoty (szczegóły są w aplikacji).
    payload = { title: 'Nowa spłata do akceptacji', body: 'Otwórz aplikację, aby zobaczyć szczegóły.', tag: `req-${id}`, url: './' };
  } else if (type === 'decision') {
    const { data: r } = await admin.from('repayment_requests').update({ decision_notified_at: now })
      .eq('id', id).eq('owner_id', caller).is('decision_notified_at', null).in('status', ['approved', 'rejected']).gt('decided_at', since)
      .select('debtor_id,status').maybeSingle();
    if (!r) return json({ ok: true, sent: 0, reason: 'pominięto' });
    const { data: a } = await admin.from('debtor_access').select('user_id').eq('debtor_id', r.debtor_id).maybeSingle();
    if (!a) return json({ ok: true, sent: 0, reason: 'dłużnik nie ma konta' });
    target = a.user_id;
    payload = {
      title: r.status === 'approved' ? 'Spłata zaakceptowana' : 'Spłata odrzucona',
      body: 'Otwórz aplikację, aby zobaczyć szczegóły.', tag: `dec-${id}`, url: './',
    };
  } else {
    return json({ error: 'Nieznany typ powiadomienia.' }, 400);
  }

  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', target);
  webpush.setVapidDetails(SUBJECT, keys.public_key, keys.private_key);
  const list = subs ?? [];
  const results = await Promise.allSettled(list.map((s) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'high' })));

  let sent = 0, removed = 0;
  const statuses: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') { sent++; statuses.push(r.value.statusCode); continue; }
    // deno-lint-ignore no-explicit-any
    const code = (r.reason as any)?.statusCode ?? 0;
    statuses.push(code);
    if (code === 404 || code === 410) { // subskrypcja wygasła lub odwołana: sprzątamy
      await admin.from('push_subscriptions').delete().eq('id', list[i].id);
      removed++;
    }
  }
  return json({ ok: true, sent, removed, statuses });
});
