-- TMT Grafik — schemat bazy dla Supabase.
-- Uruchom raz: Supabase → SQL Editor → New query → wklej całość → Run.

create table if not exists public.records (
  kind        text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (kind, id)
);

create or replace function public.touch_records() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
for each row execute function public.touch_records();

-- Lista osób z dostępem. Samo konto w Supabase nie wystarczy: e-mail musi być na tej liście.
create table if not exists public.allowed_users (
  email      text primary key,
  role       text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  added_at   timestamptz not null default now()
);
alter table public.allowed_users enable row level security;
-- Tabeli nie czyta ani nie zmienia nikt z aplikacji; zarządzasz nią tylko w panelu Supabase.

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role in ('admin', 'editor')
  );
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.allowed_users
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke execute on function public.my_role() from public, anon;
revoke execute on function public.is_allowed() from public, anon;
revoke execute on function public.can_edit() from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_allowed() to authenticated;
grant execute on function public.can_edit() to authenticated;

-- Dostęp tylko z ważnym tokenem logowania i tylko dla osób z listy allowed_users.
alter table public.records enable row level security;

drop policy if exists "zalogowani czytaja" on public.records;
create policy "zalogowani czytaja" on public.records
  for select to authenticated using (public.is_allowed());

drop policy if exists "zalogowani zapisuja" on public.records;
create policy "zalogowani zapisuja" on public.records
  for insert to authenticated with check (public.can_edit());

drop policy if exists "zalogowani zmieniaja" on public.records;
create policy "zalogowani zmieniaja" on public.records
  for update to authenticated using (public.can_edit()) with check (public.can_edit());

drop policy if exists "zalogowani usuwaja" on public.records;
create policy "zalogowani usuwaja" on public.records
  for delete to authenticated using (public.can_edit());

-- Zmiany na żywo (Realtime też przestrzega powyższych reguł): telefon i komputer widzą to samo bez odświeżania.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- Dodaj siebie (zmień e-mail) — bez tego nikt nie zobaczy danych:
-- insert into public.allowed_users (email, role) values ('twoj.email@firma.pl', 'admin');

-- ============================================================
-- Zarządzanie dostępem z aplikacji (panel „Dostęp” dla admina)
-- ============================================================

-- Admin widzi i zmienia listę dostępu z aplikacji.
drop policy if exists "admin czyta liste" on public.allowed_users;
create policy "admin czyta liste" on public.allowed_users
  for select to authenticated using (public.my_role() = 'admin');

drop policy if exists "admin dodaje" on public.allowed_users;
create policy "admin dodaje" on public.allowed_users
  for insert to authenticated with check (public.my_role() = 'admin');

drop policy if exists "admin zmienia" on public.allowed_users;
create policy "admin zmienia" on public.allowed_users
  for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists "admin usuwa" on public.allowed_users;
create policy "admin usuwa" on public.allowed_users
  for delete to authenticated using (public.my_role() = 'admin');

-- Konto może założyć tylko e-mail z listy dostępu. Obcy dostanie błąd przy rejestracji.
create or replace function public.check_allowed_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_users where lower(email) = lower(new.email)) then
    raise exception 'Adres % nie jest na liście dostępu TMT Grafik', new.email;
  end if;
  return new;
end $$;

revoke execute on function public.check_allowed_signup() from public, anon, authenticated;

drop trigger if exists tmt_check_allowed_signup on auth.users;
create trigger tmt_check_allowed_signup before insert on auth.users
for each row execute function public.check_allowed_signup();
