-- Powiadomienia push (Web Push / VAPID).
--  * push_subscriptions: subskrypcje urządzeń zalogowanych użytkowników (zapis tylko przez save_push_subscription),
--  * push_config: para kluczy VAPID generowana przez funkcję serwerową send-push; klucz prywatny jest dostępny
--    wyłącznie dla roli serwisowej (RLS włączone, bez polityk, uprawnienia odebrane anon i authenticated),
--  * repayment_requests.notified_at / decision_notified_at: znaczniki "już powiadomiono", żeby jedno zdarzenie
--    dawało najwyżej jedno powiadomienie, nawet gdy ktoś wywoła funkcję wielokrotnie.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text check (char_length(user_agent) <= 200),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke insert, update on public.push_subscriptions from authenticated;
create policy push_subscriptions_own_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Zapis subskrypcji bieżącego urządzenia. Endpoint identyfikuje urządzenie, więc przy zmianie konta na tym samym
-- urządzeniu subskrypcja przechodzi na nowego użytkownika (stary właściciel nie dostanie cudzych powiadomień).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Brak dostępu.' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000
     or coalesce(char_length(p_p256dh), 0) not between 1 and 200 or coalesce(char_length(p_auth), 0) not between 1 and 100 then
    raise exception 'Nieprawidłowa subskrypcja.' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$function$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Klucze VAPID (jeden wiersz). Czyta i zapisuje tylko funkcja serwerowa (rola serwisowa omija RLS).
create table public.push_config (
  id int primary key check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

alter table public.repayment_requests
  add column notified_at timestamptz,
  add column decision_notified_at timestamptz;
