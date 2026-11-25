-- ============================================================
-- Aplikacja pracownika: rola „employee”, kody aktywacyjne, powiadomienia push.
-- Uruchom po schema.sql (raz; można powtarzać).
-- ============================================================

alter table public.allowed_users add column if not exists worker_id text;
alter table public.allowed_users add column if not exists invite_code text;
alter table public.allowed_users add column if not exists code_expires timestamptz;

alter table public.allowed_users drop constraint if exists allowed_users_role_check;
alter table public.allowed_users add constraint allowed_users_role_check
  check (role in ('admin', 'editor', 'viewer', 'employee'));

-- Kadra (admin, edytor, podgląd) widzi wszystko; pracownik tylko swoje.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role in ('admin', 'editor', 'viewer')
  );
$$;

create or replace function public.my_worker_id() returns text
language sql stable security definer set search_path = public as $$
  select worker_id from public.allowed_users
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'employee';
$$;

revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.my_worker_id() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.my_worker_id() to authenticated;

drop policy if exists "zalogowani czytaja" on public.records;
create policy "zalogowani czytaja" on public.records
  for select to authenticated using (
    public.is_staff()
    or (
      public.my_worker_id() is not null
      and (
        kind in ('shiftDefs', 'patterns', 'exclusions', 'lines', 'stations', 'targets', 'rotaOverrides')
        or (kind = 'workers' and id = public.my_worker_id())
        or (kind in ('absences', 'assignments', 'punches') and data ->> 'workerId' = public.my_worker_id())
      )
    )
  );

-- Rejestracja tylko z e-mailem z listy i ważnym jednorazowym kodem aktywacyjnym (bez e-maili potwierdzających).
create or replace function public.check_allowed_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.allowed_users;
begin
  select * into r from public.allowed_users where lower(email) = lower(new.email);
  if not found then
    raise exception 'Adres % nie jest na liście dostępu TMT Grafik', new.email;
  end if;
  if r.invite_code is null
     or upper(coalesce(new.raw_user_meta_data ->> 'invite_code', '')) <> upper(r.invite_code)
     or (r.code_expires is not null and r.code_expires < now()) then
    raise exception 'Nieprawidłowy lub wygasły kod aktywacyjny';
  end if;
  update public.allowed_users set invite_code = null, code_expires = null where email = r.email;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;

revoke execute on function public.check_allowed_signup() from public, anon, authenticated;

-- Id konta po e-mailu — tylko dla funkcji serwerowej (reset hasła kodem).
create or replace function public.auth_user_id(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public.auth_user_id(text) from public, anon, authenticated;
grant execute on function public.auth_user_id(text) to service_role;

-- Subskrypcje powiadomień push (jedna na telefon / przeglądarkę).
create table if not exists public.push_subscriptions (
  endpoint      text primary key,
  email         text not null,
  worker_id     text,
  lang          text not null default 'pl',
  subscription  jsonb not null,
  created_at    timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "wlasne subskrypcje" on public.push_subscriptions;
create policy "wlasne subskrypcje" on public.push_subscriptions
  for all to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (worker_id is null or worker_id = public.my_worker_id())
  );

drop policy if exists "kadra widzi subskrypcje" on public.push_subscriptions;
create policy "kadra widzi subskrypcje" on public.push_subscriptions
  for select to authenticated using (public.is_staff());

-- Klucze serwera (VAPID). Bez reguł dostępu = czyta tylko funkcja serwerowa.
create table if not exists public.app_secrets (
  name   text primary key,
  value  text not null
);
alter table public.app_secrets enable row level security;
