-- TMT Grafik — RCP: kiosk QR przy wejściu.
-- Odbicia są rekordami kind = 'punches' w tabeli records; zapisuje je tylko funkcja tmt-api
-- (pracownik nie ma prawa zapisu), czas odbicia bierze serwer.

-- konto tabletu przy wejściu: widzi tylko ekran kiosku
alter table public.allowed_users drop constraint if exists allowed_users_role_check;
alter table public.allowed_users add constraint allowed_users_role_check
  check (role in ('admin', 'editor', 'viewer', 'employee', 'kiosk'));

create index if not exists records_punches_at on public.records ((data ->> 'at')) where kind = 'punches';
create index if not exists records_punches_worker on public.records ((data ->> 'workerId'), (data ->> 'at')) where kind = 'punches';

-- karty QR pracowników (wydruk albo kod w aplikacji) skanowane kamerą tabletu;
-- kod znają tylko funkcja tmt-api i wydruk — brak polityk RLS = brak dostępu z aplikacji
create table if not exists public.badges (
  worker_id text primary key,
  code text unique not null,
  created_at timestamptz not null default now()
);
alter table public.badges enable row level security;

-- odbicia z czytnika Comarch TNA na żywo: co minutę funkcja tmt-api (akcja tna_sync)
-- pobiera historię wejść/wyjść z TNA Public API; klucz zadania w app_secrets i w sejfie
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare k text := encode(gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from public.app_secrets where name = 'cron_key') then
    insert into public.app_secrets(name, value) values ('cron_key', k);
    perform vault.create_secret(k, 'tmt_cron_key', 'klucz zadania tna_sync');
  end if;
end $$;
select cron.schedule('tmt-tna-sync', '* * * * *', $$
  select net.http_post(
    url := 'https://<projekt>.supabase.co/functions/v1/tmt-api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'tmt_cron_key')),
    body := '{"action":"tna_sync"}'::jsonb, timeout_milliseconds := 55000);
$$);
