-- Historia zmian wpisów i monitoring błędów aplikacji.
--  * entry_log: każdy dopis, zmiana i usunięcie wpisu zapisuje trigger w bazie (nie da się go ominąć z aplikacji),
--    właściciel czyta tylko własne wpisy dziennika, nikt nie może ich zmieniać ani kasować,
--  * client_errors: błędy JavaScript zgłaszane przez aplikację (z limitem na użytkownika); czyta je tylko rola serwisowa.

create table public.entry_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  debtor_id uuid not null,
  entry_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  at timestamptz not null default now()
);
create index entry_log_owner_debtor_idx on public.entry_log (owner_id, debtor_id, at desc);
alter table public.entry_log enable row level security;
revoke all on public.entry_log from anon;
revoke insert, update, delete on public.entry_log from authenticated;
create policy entry_log_owner_select on public.entry_log
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.log_entry_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  owner uuid;
begin
  if tg_op = 'DELETE' then owner := old.user_id; else owner := new.user_id; end if;
  -- przy kasowaniu konta właściciela (kaskada) nie ma już komu przypisać dziennika
  if not exists (select 1 from auth.users where id = owner) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.entry_log (owner_id, debtor_id, entry_id, action, new_data, actor)
    values (owner, new.debtor_id, new.id, 'insert', to_jsonb(new), (select auth.uid()));
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      insert into public.entry_log (owner_id, debtor_id, entry_id, action, old_data, new_data, actor)
      values (owner, new.debtor_id, new.id, 'update', to_jsonb(old), to_jsonb(new), (select auth.uid()));
    end if;
  else
    insert into public.entry_log (owner_id, debtor_id, entry_id, action, old_data, actor)
    values (owner, old.debtor_id, old.id, 'delete', to_jsonb(old), (select auth.uid()));
  end if;
  return null;
end;
$function$;
create trigger entries_log after insert or update or delete on public.entries
  for each row execute function public.log_entry_change();

create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) <= 500),
  source text check (char_length(source) <= 300),
  ua text check (char_length(ua) <= 200),
  at timestamptz not null default now()
);
create index client_errors_at_idx on public.client_errors (at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create or replace function public.log_client_error(p_message text, p_source text default null, p_ua text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or p_message is null then
    return;
  end if;
  -- limit: najwyżej 30 zgłoszeń na godzinę od jednego użytkownika (ochrona przed zasypaniem tabeli)
  if (select count(*) from public.client_errors where user_id = (select auth.uid()) and at > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into public.client_errors (user_id, message, source, ua)
  values ((select auth.uid()), left(p_message, 500), left(p_source, 300), left(p_ua, 200));
end;
$function$;
revoke all on function public.log_client_error(text, text, text) from public, anon;
grant execute on function public.log_client_error(text, text, text) to authenticated;
