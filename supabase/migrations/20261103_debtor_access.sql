-- Dostęp dłużnika: własny login, podgląd swojej listy i zgłaszanie spłat do akceptacji przez właściciela.
-- Zasady bezpieczeństwa:
--  * rejestracja dla świata zostaje zamknięta; konto dłużnika zakłada wyłącznie funkcja serwerowa
--    (manage-debtor-login), która wcześniej wpisuje jednorazowe zezwolenie do allowed_signups,
--  * dłużnik NIE ma uprawnień do tabel debtors/entries; czyta swoje dane tylko przez debtor_overview(),
--    która zwraca wyłącznie bezpieczne kolumny (bez prywatnych notatek i przypomnień właściciela),
--  * zgłoszenie spłaty to jedyna operacja zapisu dłużnika (submit_repayment), a wpis spłaty powstaje
--    dopiero po akceptacji właściciela (decide_repayment).

-- 1. Jednorazowe zezwolenia na założenie konta (zapisuje je tylko rola serwisowa)
create table public.allowed_signups (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.allowed_signups enable row level security;
revoke all on public.allowed_signups from anon, authenticated;

create or replace function public.allow_only_owner_signup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if lower(new.email) = 'dawid.thai@int.pl' then
    return new;
  end if;
  delete from public.allowed_signups where created_at <= now() - interval '10 minutes';
  delete from public.allowed_signups where email = lower(new.email);
  if found then
    return new;
  end if;
  raise exception 'Rejestracja jest wyłączona.' using errcode = 'P0001';
end;
$function$;

-- 2. Konto logowania dłużnika <-> dłużnik (jeden login na dłużnika)
create table public.debtor_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  debtor_id uuid not null unique references public.debtors(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  login text not null check (login ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  created_at timestamptz not null default now()
);
create unique index debtor_access_login_key on public.debtor_access (lower(login));
create index debtor_access_owner_idx on public.debtor_access (owner_id);
alter table public.debtor_access enable row level security;
revoke all on public.debtor_access from anon;
revoke insert, update, delete on public.debtor_access from authenticated;
create policy debtor_access_owner_select on public.debtor_access
  for select to authenticated using (owner_id = (select auth.uid()));

-- 3. Zgłoszone spłaty czekające na akceptację właściciela
create table public.repayment_requests (
  id uuid primary key default gen_random_uuid(),
  debtor_id uuid not null references public.debtors(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  method text not null check (method in ('blik', 'przelew', 'gotowka', 'inne')),
  note text check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text check (char_length(decision_note) <= 200),
  entry_id uuid references public.entries(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index repayment_requests_owner_status_idx on public.repayment_requests (owner_id, status);
create index repayment_requests_debtor_idx on public.repayment_requests (debtor_id);
alter table public.repayment_requests enable row level security;
revoke all on public.repayment_requests from anon;
revoke insert, delete on public.repayment_requests from authenticated;
create policy repayment_requests_owner_select on public.repayment_requests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy repayment_requests_owner_update on public.repayment_requests
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 4. Widok dłużnika: tylko jego dane i tylko bezpieczne kolumny. Zwraca null, gdy to nie konto dłużnika.
create or replace function public.debtor_overview()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'debtor_id', d.id,
    'name', d.name,
    'login', a.login,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'date', e.date, 'amount', e.amount, 'note', coalesce(e.note, ''))
                       order by e.date, e.created_at)
      from public.entries e where e.debtor_id = d.id), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'method', r.method, 'note', coalesce(r.note, ''),
                                          'status', r.status, 'decision_note', coalesce(r.decision_note, ''), 'created_at', r.created_at)
                       order by r.created_at desc)
      from public.repayment_requests r where r.debtor_id = d.id), '[]'::jsonb))
  from public.debtor_access a
  join public.debtors d on d.id = a.debtor_id
  where a.user_id = (select auth.uid());
$function$;

-- 5. Zgłoszenie spłaty przez dłużnika (jedyny zapis dłużnika)
create or replace function public.submit_repayment(p_amount numeric, p_method text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  acc record;
  rid uuid;
begin
  select a.debtor_id, d.user_id as owner_id into acc
  from public.debtor_access a join public.debtors d on d.id = a.debtor_id
  where a.user_id = (select auth.uid());
  if not found then
    raise exception 'Brak dostępu.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Kwota musi być większa od zera.' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('blik', 'przelew', 'gotowka', 'inne') then
    raise exception 'Nieprawidłowy sposób płatności.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then
    raise exception 'Adnotacja może mieć najwyżej 200 znaków.' using errcode = '22023';
  end if;
  if (select count(*) from public.repayment_requests where debtor_id = acc.debtor_id and status = 'pending') >= 10 then
    raise exception 'Masz już 10 zgłoszeń czekających na akceptację.' using errcode = '53400';
  end if;
  insert into public.repayment_requests (debtor_id, owner_id, requested_by, amount, method, note)
  values (acc.debtor_id, acc.owner_id, (select auth.uid()), round(p_amount, 2), p_method, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into rid;
  return rid;
end;
$function$;

-- 6. Decyzja właściciela: akceptacja tworzy wpis spłaty (security invoker, więc działa tylko dla właściciela dzięki RLS)
create or replace function public.decide_repayment(p_id uuid, p_approve boolean, p_reason text default null)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  r public.repayment_requests;
  eid uuid;
  lbl text;
begin
  select * into r from public.repayment_requests where id = p_id and status = 'pending' for update;
  if not found then
    raise exception 'Zgłoszenie nie istnieje lub zostało już rozpatrzone.' using errcode = 'P0002';
  end if;
  if p_approve then
    lbl := case r.method when 'blik' then 'BLIK' when 'przelew' then 'przelew' when 'gotowka' then 'gotówka' else 'inna forma' end;
    insert into public.entries (debtor_id, type, date, amount, note)
    values (r.debtor_id, 'pay', (now() at time zone 'Europe/Warsaw')::date, r.amount,
            left('Zgłoszone przez dłużnika (' || lbl || ')' || coalesce(': ' || r.note, ''), 200))
    returning id into eid;
    update public.repayment_requests set status = 'approved', decided_at = now(), entry_id = eid where id = r.id;
  else
    update public.repayment_requests
      set status = 'rejected', decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
      where id = r.id;
  end if;
  return eid;
end;
$function$;

revoke all on function public.debtor_overview() from public, anon;
revoke all on function public.submit_repayment(numeric, text, text) from public, anon;
revoke all on function public.decide_repayment(uuid, boolean, text) from public, anon;
grant execute on function public.debtor_overview() to authenticated;
grant execute on function public.submit_repayment(numeric, text, text) to authenticated;
grant execute on function public.decide_repayment(uuid, boolean, text) to authenticated;
