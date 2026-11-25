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
language plpgsql as $$
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

revoke execute on function public.my_role() from anon;
revoke execute on function public.is_allowed() from anon;
revoke execute on function public.can_edit() from anon;

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
